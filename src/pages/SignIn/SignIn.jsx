import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import BrandWordmark from "../../components/BrandWordmark/BrandWordmark";
import { forgotPassword, resendVerification, resetPassword, verifyEmail } from "../../services/api";
import { phoneError } from "../../services/phone";
import "./SignIn.css";

/**
 * Backend field name -> the form control that owns it. The registration DTO happens to use the
 * same names as this form, so most entries are identity; the map exists so a rename on either side
 * fails loudly here instead of silently dropping a message on the floor. Anything unrecognised is
 * kept under its own key rather than discarded — an unmapped message still belongs on screen.
 */
const FIELD_ALIASES = { name: "name", email: "email", phoneNumber: "phoneNumber", password: "password" };
/** Form field -> the id already on that input, used for focus and for aria-describedby. */
const FIELD_DOM_ID = {
  name: "register-name",
  email: "signin-email",
  password: "signin-password",
  confirmPassword: "register-confirm-password",
  phoneNumber: "register-phone",
};
const mapValidationErrors = (validationErrors) => {
  if (!validationErrors || typeof validationErrors !== "object") return {};
  return Object.entries(validationErrors).reduce((mapped, [field, message]) => {
    if (typeof message === "string" && message.trim()) mapped[FIELD_ALIASES[field] || field] = message;
    return mapped;
  }, {});
};
/** Moves focus to the first field the server rejected, so a keyboard user is not left hunting. */
const focusField = (field) => {
  const control = document.getElementById(FIELD_DOM_ID[field] || field);
  if (control && typeof control.focus === "function") control.focus();
};

/**
 * Client-side mirror of RegisterRequest's bean validation, so a required or malformed field is
 * named immediately instead of after a round trip.
 *
 * The messages are copied verbatim from the server's annotations — "Name is required",
 * "Invalid email format", "Password must be between 8 and 100 characters" — so the customer sees
 * the same sentence whichever side rejects it, and a change on one side that is not mirrored here
 * shows up as two different wordings rather than silently diverging behaviour.
 *
 * Deliberately no stricter than the backend. phoneNumber carries only @Size(max = 20) server-side,
 * so this checks length and nothing else: inventing a format rule here would reject numbers the
 * API would happily accept, which is its own kind of desync.
 *
 * Values are trimmed before checking because the server trims too (AuthenticationServiceImpl
 * normalises name, email and phone), so "   " must fail as empty rather than pass as three
 * characters.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validateRegistration = ({ name, email, password, confirmPassword, phoneNumber }) => {
  const errors = {};
  const trimmedName = (name || "").trim();
  const trimmedEmail = (email || "").trim();
  const trimmedPhone = (phoneNumber || "").trim();

  if (!trimmedName) errors.name = "Name is required";
  else if (trimmedName.length > 255) errors.name = "Name cannot be longer than 255 characters";

  if (!trimmedEmail) errors.email = "Email is required";
  else if (!EMAIL_SHAPE.test(trimmedEmail)) errors.email = "Invalid email format";
  else if (trimmedEmail.length > 255) errors.email = "Email cannot be longer than 255 characters";

  if (!password) errors.password = "Password is required";
  else if (password.length < 8 || password.length > 100) {
    errors.password = "Password must be between 8 and 100 characters";
  }

  // confirmPassword has no server counterpart — it is never sent — so this is the only place it
  // can be checked.
  if (!confirmPassword) errors.confirmPassword = "Confirm your password";
  else if (password && password !== confirmPassword) {
    errors.confirmPassword = "This does not match the password above.";
  }

  // Optional, but if given it must be a real Indian mobile — the same rule PhoneNumbers enforces
  // on the server, reached through the one shared client module so the forms cannot drift.
  const phoneProblem = phoneError(trimmedPhone);
  if (phoneProblem) errors.phoneNumber = phoneProblem;

  return errors;
};

/** One field's message, tied to its input by id via aria-describedby. Renders nothing when clean. */
const FieldError = ({ id, message }) => (message
  ? <p id={id} className="signin-field-error" role="alert">{message}</p>
  : null);

const SignIn = () => {
  const [mode, setMode] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [googleStatus, setGoogleStatus] = useState("loading");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  // Clears one field's message the moment the customer edits it, so a corrected field stops
  // looking wrong without waiting for another round trip. Other fields keep their messages.
  const clearFieldError = (field) => setFieldErrors((current) => {
    if (!current[field]) return current;
    const next = { ...current };
    delete next[field];
    return next;
  });
  const { signIn, register, signInWithGoogle, isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const resetToken = new URLSearchParams(location.search).get("resetToken") || "";
  const verifyToken = new URLSearchParams(location.search).get("verifyToken") || "";
  const registering = mode === "register";
  const googleButtonRef = useRef(null);
  const verificationStartedRef = useRef(false);
  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID
    || "1022754831628-ta16sf3udggob1bsn3d8u4rmuh4jd4d1.apps.googleusercontent.com";

  useEffect(() => { if (resetToken) setMode("reset"); }, [resetToken]);

  useEffect(() => {
    if (!verifyToken || verificationStartedRef.current) return undefined;
    verificationStartedRef.current = true;
    setMode("verify"); setError(""); setNotice(""); setSubmitting(true);
    verifyEmail(verifyToken)
      .then((response) => setNotice(response.message))
      .catch((err) => setError(err.message || "Unable to verify this email address."))
      .finally(() => setSubmitting(false));
    return undefined;
  }, [verifyToken]);

  useEffect(() => {
    const renderGoogleButton = () => {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return false;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setError("");
          setSubmitting(true);
          try {
            await signInWithGoogle(credential);
            navigate("/", { replace: true });
          } catch (err) {
            setError(err.message || "Unable to continue with Google.");
          } finally {
            setSubmitting(false);
          }
        },
      });
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: "standard", theme: "outline", size: "large", shape: "rectangular",
        text: registering ? "signup_with" : "signin_with",
        width: Math.min(400, googleButtonRef.current.clientWidth || 400),
      });
      setGoogleStatus("ready");
      return true;
    };
    setGoogleStatus("loading");
    if (renderGoogleButton()) return undefined;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (renderGoogleButton()) window.clearInterval(timer);
      else if (attempts >= 50) {
        window.clearInterval(timer);
        setGoogleStatus("error");
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [googleClientId, navigate, registering, signInWithGoogle]);

  // Recovery links must remain usable even if this browser still has an
  // authenticated cookie. Otherwise opening the email redirects customers to
  // the storefront before the reset form can read its one-time token.
  if (isAuthenticated && !resetToken && !verifyToken) {
    return <Navigate to={isAdmin ? "/admin" : "/"} replace />;
  }

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    // Guard against a double submit. `submitting` already disables the button, but a rapid second
    // Enter can land before React re-renders, and registration must create exactly one account.
    if (submitting) return;

    if (registering) {
      const invalid = validateRegistration({ name, email, password, confirmPassword, phoneNumber });
      if (Object.keys(invalid).length) {
        setFieldErrors(invalid);
        setError("Please correct the highlighted fields.");
        // Focus the first invalid field in FORM order, not object order, so focus moves down the
        // page rather than to whichever key the validator happened to write first.
        const firstInvalid = ["name", "email", "password", "confirmPassword", "phoneNumber"]
          .find((field) => invalid[field]);
        focusField(firstInvalid);
        return;
      }
    }
    setSubmitting(true);
    try {
      if (registering) {
        const response = await register({ name, email, phoneNumber, password });
        setMode("signin"); setPassword(""); setConfirmPassword("");
        setNotice(response.message || "Account created. Check your email to verify your account.");
        return;
      }
      const user = await signIn(email, password);
      const requestedPath = location.state?.from?.pathname;
      navigate(user.roles?.includes("ADMIN") ? "/admin" : requestedPath || "/", { replace: true });
    } catch (err) {
      // A bean-validation failure carries one message per field. Render those against their inputs
      // and keep err.message only as a summary — it is deliberately generic on the server, so on
      // its own it tells the customer nothing actionable.
      const fields = mapValidationErrors(err.validationErrors);
      if (Object.keys(fields).length) {
        setFieldErrors(fields);
        setError(err.message || "Please correct the highlighted fields.");
        focusField(Object.keys(fields)[0]);
      } else {
        setError(err.message || (registering ? "Unable to create your account." : "Unable to sign in."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setError(""); setNotice("");
    if (!email.trim()) { setError("Enter your email address first."); return; }
    setSubmitting(true);
    try {
      const response = await resendVerification(email.trim().toLowerCase());
      setNotice(response.message);
    } catch (err) { setError(err.message || "Unable to send a verification email."); }
    finally { setSubmitting(false); }
  };

  // Registration stays submittable even when empty. A disabled button tells a customer only that
  // something is wrong somewhere; submitting and getting "Name is required" under the name box
  // tells them what to do. Validation, not the button, is what refuses an incomplete form — and it
  // refuses it before any request is made. Sign-in keeps its original guard: it has two fields, and
  // there is no per-field message to reveal by letting it through.
  const canSubmit = registering || (email && password);

  const handleRecovery = async (event) => {
    event.preventDefault(); setError(""); setNotice(""); setSubmitting(true);
    try {
      if (mode === "forgot") {
        const response = await forgotPassword(email.trim().toLowerCase());
        setNotice(response.message);
      } else {
        if (password !== confirmPassword) throw new Error("Passwords do not match.");
        const response = await resetPassword(resetToken, password);
        setNotice(response.message);
        navigate("/signin", { replace: true });
        setTimeout(() => changeMode("signin"), 1200);
      }
    } catch (err) { setError(err.message || "Unable to reset your password."); }
    finally { setSubmitting(false); }
  };

  if (mode === "forgot" || mode === "reset" || mode === "verify") return (
    <main className="signin-page">
      <section className="signin-story" aria-label="Shades World introduction">
        <Link to="/" className="signin-brand"><BrandWordmark light /></Link>
        <div className="signin-story-copy"><span className="signin-eyebrow">{mode === "verify" ? "Secure email verification" : "Secure account recovery"}</span><h1>{mode === "verify" ? "Confirm the view is yours." : "A clear way back to your account."}</h1><p>{mode === "verify" ? "Verification links are private, expire after 24 hours and can only be used once." : "Reset links are private, expire after 30 minutes and can only be used once."}</p></div>
        <p className="signin-story-note">Shades World will never ask you to share a private account link.</p>
      </section>
      <section className="signin-panel"><div className="signin-card">
        <div className="signin-mobile-brand"><BrandWordmark /></div>
        <span className="signin-kicker">Account security</span>
        <h2>{mode === "forgot" ? "Forgot password" : mode === "verify" ? "Verify your email" : "Choose a new password"}</h2>
        <p className="signin-intro">{mode === "forgot" ? "Enter your account email and we’ll send you a secure reset link." : mode === "verify" ? "We are securely checking your one-time verification link." : "Use at least 8 characters for your new password."}</p>
        {mode === "verify" ? <div aria-live="polite">{submitting && <p>Verifying your email…</p>}{error && <div className="signin-error" role="alert">{error}</div>}{notice && <div className="signin-success" role="status">{notice}</div>}</div> : <form onSubmit={handleRecovery} noValidate>
          {error && <div className="signin-error" role="alert">{error}</div>}
          {notice && <div className="signin-success" role="status">{notice}</div>}
          {mode === "forgot" ? <><label htmlFor="recovery-email">Email address</label><input id="recovery-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength="255" required /></> : <>
            <label htmlFor="reset-password">New password</label><input id="reset-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength="8" maxLength="100" required />
            <label htmlFor="reset-confirm-password">Confirm new password</label><input id="reset-confirm-password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength="8" maxLength="100" required />
            <button type="button" className="signin-link password-visibility" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide passwords" : "Show passwords"}</button>
          </>}
          <button className="signin-submit" type="submit" disabled={submitting || (mode === "forgot" ? !email : !password || !confirmPassword)}>{submitting ? "Please wait…" : mode === "forgot" ? "Send reset link" : "Reset password"}</button>
        </form>}
        <p className="signin-create"><button type="button" onClick={() => { navigate("/signin", { replace: true }); changeMode("signin"); }}>Back to sign in</button></p>
        <Link to="/" className="signin-back">← Continue shopping as a guest</Link>
      </div></section>
    </main>
  );

  return (
    <main className="signin-page">
      <section className="signin-story" aria-label="Shades World introduction">
        <Link to="/" className="signin-brand"><BrandWordmark light /></Link>
        <div className="signin-story-copy">
          <span className="signin-eyebrow">Designed for every point of view</span>
          <h1>{registering ? "Your view. Your account." : "Welcome back to a clearer world."}</h1>
          <p>{registering ? "Join Shades World to save favourites, shop faster and follow every order." : "Sign in to track orders, save your favourites and discover eyewear selected for you."}</p>
        </div>
        <p className="signin-story-note">Customers and store administrators use the same secure entrance.</p>
      </section>

      <section className="signin-panel">
        <div className="signin-card">
          <div className="signin-mobile-brand"><BrandWordmark /></div>
          <div className="signin-tabs" aria-label="Account access">
            <button type="button" aria-pressed={!registering} className={!registering ? "active" : ""} onClick={() => changeMode("signin")}>Sign in</button>
            <button type="button" aria-pressed={registering} className={registering ? "active" : ""} onClick={() => changeMode("register")}>Create account</button>
          </div>
          <span className="signin-kicker">{registering ? "Join Shades World" : "Your account"}</span>
          <h2>{registering ? "Create account" : "Sign in"}</h2>
          <p className="signin-intro">{registering ? "Create your customer account to shop, save favourites and track orders." : "Use the email and password associated with your Shades World account."}</p>

          <>
            <div className="signin-google" ref={googleButtonRef} aria-label="Continue with Google" />
            {googleStatus === "loading" && <p className="signin-google-status">Loading Google sign-in…</p>}
            {googleStatus === "error" && <p className="signin-google-status error">Google sign-in could not load. Disable blocking extensions and refresh.</p>}
            <div className="signin-divider"><span>or use email</span></div>
          </>

          <form onSubmit={handleSubmit} noValidate>
            {error && <div className="signin-error" role="alert">{error}</div>}
            {notice && <div className="signin-success" role="status">{notice}</div>}
            {registering && <>
              <label htmlFor="register-name">Full name</label>
              <input id="register-name" type="text" value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }} autoComplete="name" placeholder="Your full name" maxLength="255" required
                aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "register-name-error" : undefined} />
              <FieldError id="register-name-error" message={fieldErrors.name} />
            </>}
            <label htmlFor="signin-email">Email address</label>
            <input id="signin-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }} autoComplete="email" placeholder="you@example.com" maxLength="255" required
              aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "signin-email-error" : undefined} />
            <FieldError id="signin-email-error" message={fieldErrors.email} />

            <div className="signin-password-row">
              <label htmlFor="signin-password">Password</label>
              <button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button>
            </div>
            <input id="signin-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => { setPassword(e.target.value); clearFieldError("password"); }} autoComplete={registering ? "new-password" : "current-password"} placeholder="Enter your password" minLength="8" maxLength="100" required
              aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "signin-password-error" : undefined} />
            <FieldError id="signin-password-error" message={fieldErrors.password} />

            {registering && <>
              {/* Stated before submission, not only after a rejection. */}
              <p className="signin-password-hint">Use at least 8 characters.</p>
              <label htmlFor="register-confirm-password">Confirm password</label>
              <input id="register-confirm-password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); clearFieldError("confirmPassword"); }} autoComplete="new-password" placeholder="Enter your password again" minLength="8" maxLength="100" required
                aria-invalid={Boolean(fieldErrors.confirmPassword)} aria-describedby={fieldErrors.confirmPassword ? "register-confirm-password-error" : undefined} />
              <FieldError id="register-confirm-password-error" message={fieldErrors.confirmPassword} />
              <label htmlFor="register-phone">Phone number <span className="signin-optional">Optional</span></label>
              {/* type="tel" + inputMode="numeric" gives a phone keypad on mobile. Never type="number":
                  that would accept "e", "." and "-" and can strip a leading zero on paste. */}
              <input id="register-phone" type="tel" inputMode="numeric" value={phoneNumber} onChange={(e) => { setPhoneNumber(e.target.value); clearFieldError("phoneNumber"); }} autoComplete="tel" placeholder="10-digit mobile number" maxLength="20"
                aria-invalid={Boolean(fieldErrors.phoneNumber)} aria-describedby={fieldErrors.phoneNumber ? "register-phone-error" : undefined} />
              <FieldError id="register-phone-error" message={fieldErrors.phoneNumber} />
            </>}

            {!registering && <div className="signin-options">
              <label className="signin-remember"><input type="checkbox" /> <span>Remember this device</span></label>
              <button type="button" className="signin-link" onClick={() => changeMode("forgot")}>Forgot password?</button>
            </div>}

            <button className="signin-submit" type="submit" disabled={submitting || !canSubmit}>
              {submitting ? (registering ? "Creating account..." : "Signing in...") : (registering ? "Create customer account" : "Continue")}
            </button>
          </form>
          {!registering && <p className="signin-create">Didn’t receive the verification email? <button type="button" disabled={submitting} onClick={handleResendVerification}>Resend verification</button></p>}
          <p className="signin-create">{registering ? "Already have an account?" : "New to Shades World?"} <button type="button" onClick={() => changeMode(registering ? "signin" : "register")}>{registering ? "Sign in" : "Create an account"}</button></p>
          <Link to="/" className="signin-back">← Continue shopping as a guest</Link>
        </div>
      </section>
    </main>
  );
};

export default SignIn;
