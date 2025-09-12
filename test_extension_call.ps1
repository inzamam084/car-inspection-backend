$headers = @{
    'Content-Type' = 'application/json'
    'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kd3VxcmdoZGlpZ2prdGZobXVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjEwNDI4NzQsImV4cCI6MjAzNjYxODg3NH0.4rT1fqpBUX8b-H6c3pNjKJZOE0ZGJZOqJ8X8X8X8X8X'
}

$bodyObject = @{
    function_name = 'image_data_extract'
    query = 'Provide the results with the image url'
    inspection_id = '75472e7b-8455-479b-83aa-643010b455e5'
    user_id = 'test-user'
    files = @(
        @{
            type = 'image'
            transfer_method = 'remote_url'
            url = 'https://mdwuqrghdiigjktfhmuc.supabase.co/storage/v1/object/public/inspection-photos/screenshot-1757683569471-1757683570647.jpg'
        }
    )
}

$body = $bodyObject | ConvertTo-Json -Depth 3

Write-Host "Testing extension handler scenario with service key..."
Write-Host "Request body: $body"

try {
    $response = Invoke-RestMethod -Uri 'https://mdwuqrghdiigjktfhmuc.supabase.co/functions/v1/function-call' -Method Post -Headers $headers -Body $body
    Write-Host "Success! Response:"
    $response | ConvertTo-Json -Depth 10
} catch {
    Write-Host "Error occurred:"
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        $reader.Close()
        Write-Host "Response Body:"
        Write-Host $responseBody
    }
}
