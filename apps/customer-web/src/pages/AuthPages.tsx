import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, CheckCircle2, LockKeyhole } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { marketplaceApi, runtimeConfig } from '../api';
import { getErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthProvider';
import { otpChallengeStorage } from '../auth/otpChallengeStorage';
import { OtpInput } from '../components/auth/OtpInput';
import { FormField } from '../components/ui/FormField';
import type { CustomerOtpChallenge } from '../api/types';
import { resendMsg91Otp, startMsg91Otp, verifyMsg91Otp } from '../auth/msg91OtpWidget';

const loginSchema = z.object({ emailOrMobile: z.string().min(5, 'Enter your email or mobile number.'), password: z.string().min(8, 'Password must be at least 8 characters.') });
type LoginForm = z.infer<typeof loginSchema>;
const TEST_CUSTOMER_MOBILE = '9876543210';
const TEST_CUSTOMER_OTP = '123456';
const TEST_CUSTOMER_EMAIL = 'customer@gyami.test';
const TEST_CUSTOMER_PASSWORD = 'Demo@12345Secure';

function GoogleIcon() {
  return <svg className="google-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.89h5.38a4.6 4.6 0 0 1-2 3.02v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.37Z" />
    <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.4l-3.24-2.52c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.6A10 10 0 0 0 12 22Z" />
    <path fill="#FBBC05" d="M6.39 13.91A6.02 6.02 0 0 1 6.08 12c0-.66.11-1.3.31-1.91v-2.6H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.51l3.35-2.6Z" />
    <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.49l3.35 2.6C7.18 7.72 9.39 5.96 12 5.96Z" />
  </svg>;
}

type GoogleIdentityResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: { client_id: string; callback: (response: GoogleIdentityResponse) => void; auto_select: boolean }): void;
          renderButton(element: HTMLElement, options: { theme: string; size: string; width: number; text: string }): void;
        };
      };
    };
  }
}

function GoogleIdentityButton({ onCredential }: { onCredential: (credential: string) => void | Promise<void> }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const clientId = runtimeConfig.googleClientId;
    if (!clientId || !mount.current) return;
    let disposed = false;
    const render = () => {
      if (disposed || !mount.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        auto_select: false,
        callback: ({ credential }) => { if (credential) void onCredential(credential); },
      });
      window.google.accounts.id.renderButton(mount.current, {
        theme: 'outline', size: 'large', width: Math.max(260, mount.current.clientWidth), text: 'continue_with',
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) {
      if (window.google) render();
      else existing.addEventListener('load', render, { once: true });
      return () => { disposed = true; existing.removeEventListener('load', render); };
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.addEventListener('load', render, { once: true });
    document.head.append(script);
    return () => { disposed = true; script.removeEventListener('load', render); };
  }, [onCredential]);
  return <div className="google-identity-button" ref={mount} aria-label="Continue with Google" />;
}

const registerSchema = z.object({
  name: z.string().min(2, 'Enter your full name.'),
  email: z.email('Enter a valid email address.'),
  mobile: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.'),
  password: z.string().min(10, 'Use at least 10 characters.').regex(/[A-Z]/, 'Include an uppercase letter.').regex(/[0-9]/, 'Include a number.'),
  acceptTerms: z.boolean().refine((value) => value, 'Please accept the terms to continue.'),
});
type RegisterForm = z.infer<typeof registerSchema>;

const forgotSchema = z.object({ emailOrMobile: z.string().min(5, 'Enter your registered email or mobile number.') });
type ForgotForm = z.infer<typeof forgotSchema>;

const resetSchema = z.object({ password: z.string().min(10, 'Use at least 10 characters.').regex(/[A-Z]/, 'Include an uppercase letter.').regex(/[0-9]/, 'Include a number.'), confirmPassword: z.string() }).refine((values) => values.password === values.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });
type ResetForm = z.infer<typeof resetSchema>;

function AuthShell({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return <div className="auth-page"><section className="auth-story"><Link className="back-link back-link--light" to="/"><ArrowLeft size={17} /> Back to store</Link><div><span className="eyebrow eyebrow--light">GYAMI Global customer</span><h1>Your ritual.<br />Beautifully personal.</h1><p>Sign in to discover the collection, manage your details, and follow every order with confidence.</p><ul><li><CheckCircle2 /> Official GYAMI Global products</li><li><CheckCircle2 /> Secure customer account</li><li><CheckCircle2 /> Protected checkout experience</li></ul></div></section><section className="auth-panel"><div className="auth-card"><LockKeyhole className="auth-icon" aria-hidden="true" /><h2>{title}</h2><p>{intro}</p>{children}{runtimeConfig.isMock && <div className="mock-note">Development-only authentication. Google and OTP actions create a local test session; no external account or SMS is used.</div>}</div></section></div>;
}

export function LoginPage() {
  const { completeOtp, googleLogin, isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { from?: string; notice?: string } | null;
  const destination = locationState?.from ?? '/account';
  const [serverError, setServerError] = useState('');
  const [mobile, setMobile] = useState(TEST_CUSTOMER_MOBILE);
  const [otp, setOtp] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema), defaultValues: { emailOrMobile: '', password: '' } });
  const finishGoogleLogin = useCallback(async (credential: string) => {
    try {
      setServerError('');
      await googleLogin(credential);
      void navigate(destination, { replace: true });
    } catch (error) {
      setServerError(getErrorMessage(error));
    }
  }, [destination, googleLogin, navigate]);
  if (isAuthenticated) return <Navigate to={destination} replace />;
  const finishTestLogin = async (method: 'GOOGLE' | 'MOBILE') => {
    if (!runtimeConfig.isMock) {
      const result = await login({
        emailOrMobile: method === 'GOOGLE' ? TEST_CUSTOMER_EMAIL : mobile,
        password: TEST_CUSTOMER_PASSWORD,
      });
      if ('verificationRequired' in result) throw new Error('The development customer must be pre-verified.');
      void navigate(destination, { replace: true });
      return;
    }
    await completeOtp({
      accessToken: `development-customer-${method.toLowerCase()}-access`,
      refreshToken: `development-customer-${method.toLowerCase()}-refresh`,
      customer: {
        id: `customer-demo-${method.toLowerCase()}`,
        name: 'Demo Customer',
        email: method === 'GOOGLE' ? 'demo@gyami.test' : undefined,
        mobile: method === 'MOBILE' ? mobile : undefined,
        mobileVerified: method === 'MOBILE',
        role: 'CUSTOMER',
      },
    });
    void navigate(destination, { replace: true });
  };
  if (runtimeConfig.isMock || import.meta.env.DEV) return <AuthShell title="Welcome back" intro="Continue with Google or verify your mobile number.">
    <div className="test-auth-stack">
      <button className="button button--secondary button--full google-login" type="button" onClick={() => void finishTestLogin('GOOGLE')}><GoogleIcon /> Continue with Google</button>
      <div className="auth-divider"><span>or use mobile OTP</span></div>
      <label className="form-field">Mobile number<input inputMode="numeric" autoComplete="tel" maxLength={10} value={mobile} onChange={(event) => { setMobile(event.target.value.replace(/\D/g, '').slice(0, 10)); setOtpRequested(false); setOtp(''); setServerError(''); }} /></label>
      {!otpRequested ? <button className="button button--primary button--full" type="button" onClick={() => { if (!/^[6-9]\d{9}$/.test(mobile)) { setServerError('Enter a valid 10-digit Indian mobile number.'); return; } setServerError(''); setOtpRequested(true); }}>Send test OTP</button> : <>
        <div className="test-otp-note" role="status">Test OTP: <strong>{TEST_CUSTOMER_OTP}</strong></div>
        <label className="form-field">6-digit OTP<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(event) => { setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setServerError(''); }} /></label>
        <button className="button button--primary button--full" type="button" disabled={otp.length !== 6} onClick={() => { if (otp !== TEST_CUSTOMER_OTP) { setServerError('Incorrect test OTP. Use 123456.'); return; } void finishTestLogin('MOBILE'); }}>Verify OTP & sign in</button>
      </>}
      {serverError && <p className="form-error" role="alert">{serverError}</p>}
    </div>
    <p className="auth-switch">New to GYAMI Global? <Link to="/register">Create an account</Link></p>
  </AuthShell>;
  const submit = form.handleSubmit(async (values) => { try { setServerError(''); const result = await login(values); if ('verificationRequired' in result) { otpChallengeStorage.set(result); void navigate('/verify-account', { replace: true }); return; } void navigate(destination, { replace: true }); } catch (error) { setServerError(getErrorMessage(error)); } });
  return <AuthShell title="Welcome back" intro="Sign in to continue to your account and checkout.">{runtimeConfig.googleClientId && <><GoogleIdentityButton onCredential={finishGoogleLogin} /><div className="auth-divider"><span>or use your account</span></div></>}<form className="stack-form" onSubmit={(event) => void submit(event)} noValidate>{locationState?.notice && <p className="form-success" role="status">{locationState.notice}</p>}<FormField label="Email or mobile" autoComplete="username" registration={form.register('emailOrMobile')} error={form.formState.errors.emailOrMobile} /><FormField label="Password" type="password" autoComplete="current-password" registration={form.register('password')} error={form.formState.errors.password} />{serverError && <p className="form-error" role="alert">{serverError}</p>}<div className="form-row-between"><span>Secure customer session</span><Link to="/forgot-password">Forgot password?</Link></div><button className="button button--primary button--full" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}</button></form><p className="auth-switch">New to GYAMI Global? <Link to="/register">Create an account</Link></p></AuthShell>;
}

export function RegisterPage() {
  const { isAuthenticated, register } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const form = useForm<RegisterForm>({ resolver: zodResolver(registerSchema), defaultValues: { name: '', email: '', mobile: '', password: '', acceptTerms: false } });
  if (isAuthenticated) return <Navigate to="/account" replace />;
  const submit = form.handleSubmit(async (values) => { try { setServerError(''); const input = { name: values.name, email: values.email, mobile: values.mobile, password: values.password }; const result = await register(input); if ('verificationRequired' in result) { otpChallengeStorage.set(result); void navigate('/verify-account', { replace: true }); return; } void navigate('/account', { replace: true }); } catch (error) { setServerError(getErrorMessage(error)); } });
  return <AuthShell title="Create your account" intro="Register as a customer to save addresses and check out."><form className="stack-form" onSubmit={(event) => void submit(event)} noValidate><FormField label="Full name" autoComplete="name" registration={form.register('name')} error={form.formState.errors.name} /><FormField label="Email" type="email" autoComplete="email" registration={form.register('email')} error={form.formState.errors.email} /><FormField label="Mobile" inputMode="numeric" autoComplete="tel" registration={form.register('mobile')} error={form.formState.errors.mobile} /><FormField label="Password" type="password" autoComplete="new-password" hint="At least 10 characters, with an uppercase letter and number." registration={form.register('password')} error={form.formState.errors.password} /><label className="checkbox-field"><input type="checkbox" {...form.register('acceptTerms')} /> I agree to the customer terms and privacy policy.</label>{form.formState.errors.acceptTerms && <small className="field-error">{form.formState.errors.acceptTerms.message}</small>}{serverError && <p className="form-error" role="alert">{serverError}</p>}<button className="button button--primary button--full" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Creating account…' : 'Create account'}</button></form><p className="auth-switch">Already registered? <Link to="/login">Sign in</Link></p></AuthShell>;
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'request' | 'otp' | 'password'>('request');
  const [challengeToken, setChallengeToken] = useState('');
  const [maskedDestination, setMaskedDestination] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const [notice, setNotice] = useState('');
  const [otpChallenge, setOtpChallenge] = useState<CustomerOtpChallenge | null>(null);
  const [requestId, setRequestId] = useState<string>();
  const form = useForm<ForgotForm>({ resolver: zodResolver(forgotSchema), defaultValues: { emailOrMobile: '' } });
  const resetForm = useForm<ResetForm>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirmPassword: '' } });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const request = form.handleSubmit(async ({ emailOrMobile }) => { try { setBusy(true); setServerError(''); const result = await marketplaceApi.forgotPassword(emailOrMobile); if (!result.otp) throw new Error(result.message); const challenge: CustomerOtpChallenge = { verificationRequired: true, challengeToken: result.challengeToken, maskedDestination: result.maskedDestination, message: result.message, expiresInMinutes: 5, resendAfterSeconds: result.resendAfterSeconds, otp: result.otp }; setChallengeToken(result.challengeToken); setMaskedDestination(result.maskedDestination); setOtpChallenge(challenge); const nextRequestId = await startMsg91Otp(challenge); setRequestId(nextRequestId); setCooldown(result.resendAfterSeconds); setNotice('A verification code was sent by SMS.'); setStep('otp'); } catch (error) { setServerError(getErrorMessage(error)); } finally { setBusy(false); } });
  const verify = async (event: React.FormEvent) => { event.preventDefault(); if (!/^\d{6}$/.test(code)) { setServerError('Enter the complete 6-digit verification code.'); return; } if (!otpChallenge) return; try { setBusy(true); setServerError(''); const accessToken = await verifyMsg91Otp(otpChallenge, code, requestId); const result = await marketplaceApi.verifyPasswordResetOtp(challengeToken, accessToken); setResetToken(result.resetToken); setStep('password'); } catch (error) { setCode(''); setServerError(getErrorMessage(error)); } finally { setBusy(false); } };
  const resend = async () => { if (!otpChallenge) return; try { setBusy(true); setServerError(''); setNotice(''); const nextRequestId = await resendMsg91Otp(otpChallenge, requestId); setRequestId(nextRequestId); setCooldown(otpChallenge.resendAfterSeconds); setCode(''); setNotice('A new verification code was sent by SMS.'); } catch (error) { setServerError(getErrorMessage(error)); } finally { setBusy(false); } };
  const updatePassword = resetForm.handleSubmit(async ({ password }) => { try { setServerError(''); await marketplaceApi.resetPassword({ token: resetToken, password }); void navigate('/login', { replace: true, state: { notice: 'Password updated. Sign in with your new password.' } }); } catch (error) { setServerError(getErrorMessage(error)); } });

  return <AuthShell title="Reset your password" intro={step === 'request' ? 'Verify your registered mobile before choosing a new password.' : step === 'otp' ? `Enter the code sent to ${maskedDestination}.` : 'Choose a strong new password for your account.'}>
    {step === 'request' && <form className="stack-form" onSubmit={(event) => void request(event)} noValidate><FormField label="Email or mobile" autoComplete="username" registration={form.register('emailOrMobile')} error={form.formState.errors.emailOrMobile} />{serverError && <p className="form-error" role="alert">{serverError}</p>}<button className="button button--primary button--full" disabled={busy}>{busy ? 'Sending…' : 'Send verification code'}</button></form>}
    {step === 'otp' && <form className="stack-form" onSubmit={(event) => void verify(event)}><span className="otp-label">6-digit verification code</span><OtpInput value={code} onChange={setCode} disabled={busy} />{notice && <p className="form-success" role="status">{notice}</p>}{serverError && <p className="form-error" role="alert">{serverError}</p>}<button className="button button--primary button--full" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify code'}</button><div className="otp-resend"><span>Didn’t receive it?</span><button className="link-button" type="button" disabled={busy || cooldown > 0} onClick={() => void resend()}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}</button></div></form>}
    {step === 'password' && <form className="stack-form" onSubmit={(event) => void updatePassword(event)} noValidate><FormField label="New password" type="password" autoComplete="new-password" hint="At least 10 characters, with an uppercase letter and number." registration={resetForm.register('password')} error={resetForm.formState.errors.password} /><FormField label="Confirm new password" type="password" autoComplete="new-password" registration={resetForm.register('confirmPassword')} error={resetForm.formState.errors.confirmPassword} />{serverError && <p className="form-error" role="alert">{serverError}</p>}<button className="button button--primary button--full" disabled={resetForm.formState.isSubmitting}>{resetForm.formState.isSubmitting ? 'Updating…' : 'Update password'}</button></form>}
    <p className="auth-switch"><Link to="/login">Return to sign in</Link></p>
  </AuthShell>;
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const token = params.get('token') ?? '';
  const form = useForm<ResetForm>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirmPassword: '' } });
  const submit = form.handleSubmit(async ({ password }) => { try { setServerError(''); await marketplaceApi.resetPassword({ token, password }); void navigate('/login', { replace: true }); } catch (error) { setServerError(getErrorMessage(error)); } });
  return <AuthShell title="Choose a new password" intro="Enter a secure password for your customer account."><form className="stack-form" onSubmit={(event) => void submit(event)} noValidate><FormField label="New password" type="password" autoComplete="new-password" registration={form.register('password')} error={form.formState.errors.password} /><FormField label="Confirm password" type="password" autoComplete="new-password" registration={form.register('confirmPassword')} error={form.formState.errors.confirmPassword} />{!token && <p className="form-error" role="alert">The reset token is missing.</p>}{serverError && <p className="form-error" role="alert">{serverError}</p>}<button className="button button--primary button--full" disabled={!token || form.formState.isSubmitting}>Update password</button></form></AuthShell>;
}
