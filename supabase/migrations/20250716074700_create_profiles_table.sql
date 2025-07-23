-- Create profiles table to store user profile information
CREATE TABLE public.profiles (
  id uuid not null references auth.users on delete cascade,
  first_name text,
  last_name text,
  email text,

  primary key (id)
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for users to view and edit their own profile
CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id);

-- Create RLS policy for service role to have full access
CREATE POLICY "Allow service role full access" 
ON public.profiles 
FOR ALL 
USING (true);

-- Grant permissions to different roles
GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

-- Create function to handle new user signup and create profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error and continue (prevents failed profile creation from blocking user signup)
        INSERT INTO public.function_logs (function_name, error_message, record_id)
        VALUES ('handle_new_user', SQLERRM, NEW.id);
        RETURN NEW;
END;
$$ LANGUAGE 'plpgsql' SECURITY DEFINER;

-- Create trigger to automatically create profile when user signs up
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
