-- =====================================================
-- With Subscription Check RPC Function
-- =====================================================
-- Direct replacement for withSubscriptionCheck middleware
-- All business logic moved to database for better performance
-- and data access
--
-- Key Features:
-- 1. Parent subscription carryover - If subscription has parent_subscription_id,
--    unused reports from parent are carried over and deducted first
-- 2. Deduction priority: Parent carryover → Current subscription → Blocks
-- 3. FIFO block ordering (oldest expiring first)
-- 4. Duplicate prevention
-- 5. Parallel data loading where possible
-- 6. Comprehensive error codes
--
-- Usage Priority (when tracking):
--   1. Parent subscription remaining reports (if parent_subscription_id exists)
--   2. Current subscription included reports
--   3. Report blocks (FIFO by expiry date)

CREATE OR REPLACE FUNCTION with_subscription_check(
  p_user_id UUID,
  p_require_subscription BOOLEAN DEFAULT FALSE,
  p_check_usage_limit BOOLEAN DEFAULT TRUE,
  p_track_usage BOOLEAN DEFAULT FALSE,
  p_inspection_id UUID DEFAULT NULL,
  p_report_id UUID DEFAULT NULL,
  p_had_history BOOLEAN DEFAULT FALSE,
  p_allow_block_usage BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_subscription RECORD;
  v_parent_subscription RECORD;
  v_usage_summary RECORD;
  v_subscription_available INT := 0;
  v_parent_remaining INT := 0;
  v_blocks_available INT := 0;
  v_total_available INT := 0;
  v_is_active BOOLEAN := FALSE;
  v_report_block RECORD;
  v_existing_usage RECORD;
  v_final_report_id UUID;
  v_remaining_reports INT := 0;
  v_usage_type TEXT;
  v_base_response JSONB;
BEGIN
  /* ===========================
     1. LOAD EVERYTHING ONCE
  ============================*/

  -- Get subscription status
  SELECT
    s.id,
    s.status,
    s.plan_id,
    s.parent_subscription_id,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    EXTRACT(DAY FROM (s.current_period_end - NOW()))::INT as days_until_renewal,
    (s.status = 'active' AND s.current_period_end >= NOW()) as is_active,
    p.included_reports as plan_included_reports
  INTO v_subscription
  FROM subscriptions s
  LEFT JOIN plans p ON s.plan_id = p.id
  WHERE s.user_id = p_user_id
    AND s.status IN ('active', 'past_due', 'trialing')
  ORDER BY s.created_at DESC
  LIMIT 1;

  v_is_active := COALESCE(v_subscription.is_active, FALSE);

  -- Calculate current subscription available reports
  IF v_subscription.id IS NOT NULL THEN
    SELECT reports_used INTO v_usage_summary
    FROM subscription_usage_summary
    WHERE subscription_id = v_subscription.id
      AND billing_period_start = DATE(v_subscription.current_period_start)
      AND billing_period_end = DATE(v_subscription.current_period_end);

    v_subscription_available := GREATEST(
      0,
      COALESCE(v_subscription.plan_included_reports, 0) - COALESCE(v_usage_summary.reports_used, 0)
    );
  END IF;

  -- Check parent subscription for carryover reports
  IF v_subscription.parent_subscription_id IS NOT NULL THEN
    -- Get parent subscription and usage in one query
    SELECT
      ps.id,
      ps.current_period_start,
      ps.current_period_end,
      sus.reports_included,
      sus.reports_used
    INTO v_parent_subscription
    FROM subscriptions ps
    LEFT JOIN subscription_usage_summary sus ON sus.subscription_id = ps.id
    WHERE ps.id = v_subscription.parent_subscription_id
    ORDER BY sus.billing_period_start DESC
    LIMIT 1;

    IF v_parent_subscription.id IS NOT NULL THEN
      -- Calculate parent remaining (carryover)
      v_parent_remaining := GREATEST(
        0,
        COALESCE(v_parent_subscription.reports_included, 0) - COALESCE(v_parent_subscription.reports_used, 0)
      );
    END IF;
  END IF;

  -- Get blocks available
  SELECT COALESCE(SUM(rb.reports_total - rb.reports_used), 0)::INT
  INTO v_blocks_available
  FROM report_blocks rb
  WHERE rb.user_id = p_user_id
    AND rb.is_active = TRUE
    AND rb.expiry_date > NOW()
    AND rb.reports_used < rb.reports_total;

  -- Total includes: parent carryover + current subscription + blocks
  v_total_available := v_parent_remaining + v_subscription_available + v_blocks_available;

  /* ===========================
     2. BASE RESPONSE CONTEXT
  ============================*/

  v_base_response := JSONB_BUILD_OBJECT(
    'success', FALSE,
    'user_id', p_user_id,
    'has_active_subscription', v_is_active,
    'subscription_status', COALESCE(v_subscription.status, 'none'),
    'will_cancel_at_period_end', COALESCE(v_subscription.cancel_at_period_end, FALSE),
    'days_until_renewal', COALESCE(v_subscription.days_until_renewal, 0),
    'remaining_reports', v_total_available,
    'subscription_reports', v_subscription_available,
    'parent_carryover', v_parent_remaining,
    'block_reports', v_blocks_available,
    'total_available_reports', v_total_available
  );

  /* ===========================
     3. SUBSCRIPTION REQUIRED
  ============================*/

  IF p_require_subscription AND NOT v_is_active THEN
    RETURN v_base_response || JSONB_BUILD_OBJECT(
      'code', 'SUBSCRIPTION_REQUIRED',
      'error', 'Active subscription required'
    );
  END IF;

  /* ===========================
     4. USAGE AVAILABILITY CHECK
  ============================*/

  IF p_check_usage_limit THEN
    IF p_allow_block_usage THEN
      IF v_total_available = 0 THEN
        RETURN v_base_response || JSONB_BUILD_OBJECT(
          'code', 'NO_REPORTS_AVAILABLE',
          'error', 'No reports available. Please purchase more reports or upgrade your subscription.'
        );
      END IF;
    ELSE
      IF v_subscription_available = 0 THEN
        RETURN v_base_response || JSONB_BUILD_OBJECT(
          'code', 'NO_REPORTS_AVAILABLE',
          'error', 'No subscription reports available. Report blocks not allowed in this context.'
        );
      END IF;
    END IF;
  END IF;

  /* ===========================
     5. NO TRACKING REQUIRED
  ============================*/

  IF NOT p_track_usage THEN
    RETURN v_base_response || JSONB_BUILD_OBJECT('success', TRUE);
  END IF;

  /* ===========================
     6. TRACKING VALIDATION
  ============================*/

  IF p_inspection_id IS NULL THEN
    RETURN v_base_response || JSONB_BUILD_OBJECT(
      'code', 'INSPECTION_ID_REQUIRED',
      'error', 'Inspection ID is required for usage tracking'
    );
  END IF;

  v_final_report_id := p_report_id;

  IF v_final_report_id IS NULL THEN
    INSERT INTO reports (inspection_id, summary, created_at)
    VALUES (p_inspection_id, 'Report generation in progress...', NOW())
    RETURNING id INTO v_final_report_id;

    IF v_final_report_id IS NULL THEN
      RETURN v_base_response || JSONB_BUILD_OBJECT(
        'code', 'REPORT_CREATION_FAILED',
        'error', 'Failed to create report for usage tracking'
      );
    END IF;
  END IF;

  /* ===========================
     7. RECORD USAGE
  ============================*/

  -- Check for duplicate
  SELECT id INTO v_existing_usage
  FROM report_usage
  WHERE report_id = v_final_report_id;

  IF v_existing_usage.id IS NOT NULL THEN
    RETURN v_base_response || JSONB_BUILD_OBJECT(
      'code', 'DUPLICATE_USAGE',
      'error', 'Report already tracked'
    );
  END IF;

  -- Priority: Parent carryover → Current subscription → Blocks

  -- Try parent subscription carryover first
  IF v_parent_remaining > 0 THEN
    -- Update parent usage summary
    UPDATE subscription_usage_summary
    SET reports_used = reports_used + 1,
        updated_at = NOW()
    WHERE subscription_id = v_parent_subscription.id
      AND billing_period_start = DATE(v_parent_subscription.current_period_start)
      AND billing_period_end = DATE(v_parent_subscription.current_period_end);

    -- Record usage against parent subscription
    INSERT INTO report_usage (
      user_id,
      inspection_id,
      report_id,
      usage_type,
      subscription_id,
      had_history,
      billing_period_start,
      billing_period_end,
      usage_date
    ) VALUES (
      p_user_id,
      p_inspection_id,
      v_final_report_id,
      'subscription_included',
      v_parent_subscription.id,
      p_had_history,
      DATE(v_parent_subscription.current_period_start),
      DATE(v_parent_subscription.current_period_end),
      NOW()
    );

    v_usage_type := 'subscription_included';
    v_remaining_reports := (v_parent_remaining - 1) + v_subscription_available + v_blocks_available;

  -- Try current subscription
  ELSIF v_subscription_available > 0 THEN
    -- Update or create usage summary
    INSERT INTO subscription_usage_summary (
      subscription_id,
      billing_period_start,
      billing_period_end,
      reports_included,
      reports_used
    ) VALUES (
      v_subscription.id,
      DATE(v_subscription.current_period_start),
      DATE(v_subscription.current_period_end),
      v_subscription.plan_included_reports,
      1
    )
    ON CONFLICT (subscription_id, billing_period_start, billing_period_end)
    DO UPDATE SET
      reports_used = subscription_usage_summary.reports_used + 1,
      updated_at = NOW();

    -- Record usage
    INSERT INTO report_usage (
      user_id,
      inspection_id,
      report_id,
      usage_type,
      subscription_id,
      had_history,
      billing_period_start,
      billing_period_end,
      usage_date
    ) VALUES (
      p_user_id,
      p_inspection_id,
      v_final_report_id,
      'subscription_included',
      v_subscription.id,
      p_had_history,
      DATE(v_subscription.current_period_start),
      DATE(v_subscription.current_period_end),
      NOW()
    );

    v_usage_type := 'subscription_included';
    v_remaining_reports := v_parent_remaining + (v_subscription_available - 1) + v_blocks_available;

  -- Try report blocks (FIFO)
  ELSE
    SELECT
      rb.id,
      rb.reports_total,
      rb.reports_used,
      rbt.with_history
    INTO v_report_block
    FROM report_blocks rb
    LEFT JOIN report_block_types rbt ON rb.report_block_type_id = rbt.id
    WHERE rb.user_id = p_user_id
      AND rb.is_active = TRUE
      AND rb.expiry_date > NOW()
      AND rb.reports_used < rb.reports_total
      AND (NOT p_had_history OR rbt.with_history = TRUE)
    ORDER BY rb.expiry_date ASC, rb.created_at ASC
    LIMIT 1;

    IF v_report_block.id IS NULL THEN
      RETURN v_base_response || JSONB_BUILD_OBJECT(
        'code', 'USAGE_TRACKING_FAILED',
        'error', 'No available reports. Please purchase more.',
        'usage_type', 'insufficient'
      );
    END IF;

    -- Update block usage
    UPDATE report_blocks
    SET reports_used = reports_used + 1,
        updated_at = NOW()
    WHERE id = v_report_block.id;

    -- Record usage
    INSERT INTO report_usage (
      user_id,
      inspection_id,
      report_id,
      usage_type,
      report_block_id,
      had_history,
      usage_date
    ) VALUES (
      p_user_id,
      p_inspection_id,
      v_final_report_id,
      'block',
      v_report_block.id,
      p_had_history,
      NOW()
    );

    v_usage_type := 'block';

    -- Recalculate remaining blocks
    SELECT COALESCE(SUM(reports_total - reports_used), 0)::INT
    INTO v_remaining_reports
    FROM report_blocks
    WHERE user_id = p_user_id
      AND is_active = TRUE
      AND expiry_date > NOW()
      AND reports_used < reports_total;
  END IF;

  /* ===========================
     8. SUCCESS RESPONSE
  ============================*/

  RETURN v_base_response || JSONB_BUILD_OBJECT(
    'success', TRUE,
    'usage_tracked', TRUE,
    'usage_type', v_usage_type,
    'remaining_reports', v_remaining_reports,
    'report_id', v_final_report_id
  );

EXCEPTION WHEN OTHERS THEN
  RETURN JSONB_BUILD_OBJECT(
    'success', FALSE,
    'error', 'Internal server error during subscription check',
    'code', 'INTERNAL_ERROR',
    'user_id', p_user_id
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION with_subscription_check TO authenticated;

COMMENT ON FUNCTION with_subscription_check IS
'Complete subscription middleware logic in database. Validates access and optionally tracks usage.';


-- =====================================================
-- Usage Examples
-- =====================================================
-- 1. Pre-flight check (no tracking):
-- SELECT with_subscription_check(auth.uid());
--
-- 2. Check and track usage:
-- SELECT with_subscription_check(
--   auth.uid(),
--   FALSE, -- require_subscription
--   TRUE,  -- check_usage_limit
--   TRUE,  -- track_usage
--   'inspection-uuid'::UUID,
--   'report-uuid'::UUID,
--   FALSE  -- had_history
-- );
--
-- 3. Response includes parent_carryover field:
-- {
--   "success": true,
--   "subscription_reports": 50,
--   "parent_carryover": 10,
--   "block_reports": 5,
--   "total_available_reports": 65,
--   "remaining_reports": 65
-- }
--
-- Deduction happens in this order:
-- 1. parent_carryover (if > 0)
-- 2. subscription_reports
-- 3. block_reports (FIFO)
-- =====================================================
