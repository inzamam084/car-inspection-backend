-- Add phone number column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN phone_number text;

-- Update the handle_new_user function to include phone_number
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, phone_number)
    VALUES (NEW.id, NEW.email, NEW.phone);
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error and continue (prevents failed profile creation from blocking user signup)
        INSERT INTO public.function_logs (function_name, error_message, record_id)
        VALUES ('handle_new_user', SQLERRM, NEW.id);
        RETURN NEW;
END;
$$ LANGUAGE 'plpgsql' SECURITY DEFINER;

-- The trigger on_auth_user_created already exists and will use the updated function
-- No need to recreate the trigger as it references the function by name
