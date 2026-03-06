import { useState } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

const ADMIN_EMAIL = "admin@uniqlearn.co";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#09090e",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'DM Sans','Helvetica Neue',sans-serif",
    padding: "20px",
  },
  card: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "16px",
    padding: "40px",
    width: "100%",
    maxWidth: "420px",
    boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "8px",
  },
  logoBox: {
    width: "36px",
    height: "36px",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
    fontWeight: "700",
    color: "#fff",
  },
  logoText: {
    fontSize: "20px",
    fontWeight: "700",
    color: "#f1f5f9",
    letterSpacing: "-0.5px",
  },
  tagline: {
    fontSize: "13px",
    color: "#64748b",
    marginBottom: "32px",
  },
  title: {
    fontSize: "22px",
    fontWeight: "600",
    color: "#f1f5f9",
    marginBottom: "4px",
  },
  subtitle: {
    fontSize: "13px",
    color: "#94a3b8",
    marginBottom: "28px",
  },
  label: {
    display: "block",
    fontSize: "12px",
    fontWeight: "500",
    color: "#94a3b8",
    marginBottom: "6px",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  input: {
    width: "100%",
    padding: "10px 14px",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "8px",
    color: "#f1f5f9",
    fontSize: "14px",
    fontFamily: "'DM Sans',sans-serif",
    outline: "none",
    transition: "border-color 0.15s",
    marginBottom: "16px",
    boxSizing: "border-box",
  },
  button: {
    width: "100%",
    padding: "11px",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    border: "none",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "14px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "opacity 0.15s",
    marginTop: "4px",
    fontFamily: "'DM Sans',sans-serif",
  },
  buttonSecondary: {
    width: "100%",
    padding: "11px",
    background: "transparent",
    border: "1px solid #334155",
    borderRadius: "8px",
    color: "#94a3b8",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "all 0.15s",
    marginTop: "10px",
    fontFamily: "'DM Sans',sans-serif",
  },
  error: {
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: "8px",
    padding: "10px 14px",
    color: "#fca5a5",
    fontSize: "13px",
    marginBottom: "16px",
  },
  success: {
    background: "rgba(74,222,128,0.12)",
    border: "1px solid rgba(74,222,128,0.3)",
    borderRadius: "8px",
    padding: "10px 14px",
    color: "#86efac",
    fontSize: "13px",
    marginBottom: "16px",
  },
  divider: {
    borderTop: "1px solid #334155",
    margin: "24px 0",
  },
  link: {
    background: "none",
    border: "none",
    color: "#6366f1",
    fontSize: "13px",
    cursor: "pointer",
    padding: "0",
    fontFamily: "'DM Sans',sans-serif",
    textDecoration: "underline",
  },
  fieldGroup: {
    marginBottom: "4px",
  },
  hint: {
    fontSize: "11px",
    color: "#475569",
    marginTop: "-12px",
    marginBottom: "16px",
  },
  strengthBar: {
    height: "3px",
    borderRadius: "2px",
    marginTop: "-12px",
    marginBottom: "16px",
    transition: "all 0.2s",
  },
};

function getPasswordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

function friendlyError(code) {
  switch (code) {
    case "auth/user-not-found": return "No account found with this email.";
    case "auth/wrong-password": return "Incorrect password.";
    case "auth/invalid-credential": return "Incorrect email or password.";
    case "auth/too-many-requests": return "Too many failed attempts. Try again later or reset your password.";
    case "auth/email-already-in-use": return "An account with this email already exists.";
    case "auth/weak-password": return "Password must be at least 8 characters.";
    case "auth/invalid-email": return "Please enter a valid email address.";
    case "auth/network-request-failed": return "Network error. Check your connection.";
    default: return "Something went wrong. Please try again.";
  }
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function LoginPage() {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showPw, setShowPw] = useState(false);

  const pwStrength = getPasswordStrength(password);
  const strengthColor = ["#334155", "#ef4444", "#f97316", "#eab308", "#22c55e", "#22c55e"][pwStrength];

  function resetForm() {
    setError("");
    setSuccessMsg("");
    setPassword("");
    setConfirmPw("");
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    const trimmedEmail = email.trim().toLowerCase();

    if (!validateEmail(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
      // Auth state change in App.jsx will handle redirect
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError("");
    const trimmedEmail = email.trim().toLowerCase();

    if (!validateEmail(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }
    if (pwStrength < 2) {
      setError("Please use a stronger password (mix letters, numbers, and symbols).");
      return;
    }

    setLoading(true);
    try {
      // Check if email is invited (or is the admin email)
      const isAdminEmail = trimmedEmail === ADMIN_EMAIL;
      if (!isAdminEmail) {
        const inviteRef = doc(db, "invitedEmails", trimmedEmail);
        const inviteSnap = await getDoc(inviteRef);
        if (!inviteSnap.exists()) {
          setError("This email has not been invited. Contact your admin to get access.");
          setLoading(false);
          return;
        }
        if (inviteSnap.data().used) {
          setError("This invite has already been used. Contact your admin.");
          setLoading(false);
          return;
        }
      }

      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);

      // Create user profile in Firestore
      await setDoc(doc(db, "users", cred.user.uid), {
        email: trimmedEmail,
        role: isAdminEmail ? "admin" : "user",
        active: true,
        createdAt: serverTimestamp(),
      });

      // Mark invite as used (non-admin users)
      if (!isAdminEmail) {
        await setDoc(doc(db, "invitedEmails", trimmedEmail), {
          used: true,
          usedAt: serverTimestamp(),
          uid: cred.user.uid,
        }, { merge: true });
      }
      // Auth state change in App.jsx will handle redirect
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    setError("");
    const trimmedEmail = email.trim().toLowerCase();

    if (!validateEmail(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setSuccessMsg("Password reset email sent. Check your inbox.");
    } catch (err) {
      // Don't reveal if email exists or not (security best practice)
      setSuccessMsg("If an account exists for this email, a reset link has been sent.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 30px #0f172a inset !important;
          -webkit-text-fill-color: #f1f5f9 !important;
        }
        .login-input:focus { border-color: rgba(99,102,241,0.6) !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
        .login-btn:hover:not(:disabled) { opacity: 0.85; }
        .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .login-btn-secondary:hover { background: rgba(255,255,255,0.05) !important; color: #f1f5f9 !important; }
      `}</style>

      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoBox}>A</div>
          <span style={styles.logoText}>ARR Flow</span>
        </div>
        <div style={styles.tagline}>Revenue Intelligence Platform</div>

        {mode === "login" && (
          <>
            <div style={styles.title}>Welcome back</div>
            <div style={styles.subtitle}>Sign in to your account to continue</div>

            {error && <div style={styles.error}>{error}</div>}

            <form onSubmit={handleLogin} autoComplete="on">
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Email</label>
                <input
                  className="login-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(""); }}
                  placeholder="you@company.com"
                  style={styles.input}
                  disabled={loading}
                  maxLength={254}
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Password</label>
                <div style={{ position: "relative" }}>
                  <input
                    className="login-input"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    placeholder="••••••••"
                    style={{ ...styles.input, paddingRight: "44px" }}
                    disabled={loading}
                    maxLength={128}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    style={{
                      position: "absolute", right: "12px", top: "50%", transform: "translateY(-65%)",
                      background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px", padding: "2px",
                    }}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="login-btn"
                style={styles.button}
                disabled={loading}
              >
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <div style={{ textAlign: "center", marginTop: "16px" }}>
              <button style={styles.link} onClick={() => { setMode("forgot"); resetForm(); }}>
                Forgot password?
              </button>
            </div>

            <div style={styles.divider} />

            <div style={{ textAlign: "center", fontSize: "13px", color: "#64748b" }}>
              New user?{" "}
              <button style={styles.link} onClick={() => { setMode("signup"); resetForm(); }}>
                Create your account
              </button>
            </div>
          </>
        )}

        {mode === "signup" && (
          <>
            <div style={styles.title}>Create account</div>
            <div style={styles.subtitle}>You must be invited by an admin to register</div>

            {error && <div style={styles.error}>{error}</div>}
            {successMsg && <div style={styles.success}>{successMsg}</div>}

            <form onSubmit={handleSignup} autoComplete="on">
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Email</label>
                <input
                  className="login-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(""); }}
                  placeholder="your-invited@email.com"
                  style={styles.input}
                  disabled={loading}
                  maxLength={254}
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Password</label>
                <div style={{ position: "relative" }}>
                  <input
                    className="login-input"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(""); }}
                    placeholder="Min 8 characters"
                    style={{ ...styles.input, paddingRight: "44px", marginBottom: "8px" }}
                    disabled={loading}
                    maxLength={128}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    style={{
                      position: "absolute", right: "12px", top: "50%", transform: "translateY(-90%)",
                      background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px", padding: "2px",
                    }}
                  >
                    {showPw ? "Hide" : "Show"}
                  </button>
                </div>
                {password.length > 0 && (
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ ...styles.strengthBar, width: `${(pwStrength / 5) * 100}%`, background: strengthColor }} />
                    <div style={{ fontSize: "11px", color: "#475569", marginTop: "4px" }}>
                      {["", "Very weak", "Weak", "Fair", "Strong", "Very strong"][pwStrength]} password
                    </div>
                  </div>
                )}
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Confirm Password</label>
                <input
                  className="login-input"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setError(""); }}
                  placeholder="Repeat password"
                  style={{
                    ...styles.input,
                    borderColor: confirmPw && confirmPw !== password ? "rgba(239,68,68,0.5)" : undefined,
                  }}
                  disabled={loading}
                  maxLength={128}
                />
              </div>

              <button
                type="submit"
                className="login-btn"
                style={styles.button}
                disabled={loading}
              >
                {loading ? "Creating account…" : "Create Account"}
              </button>
            </form>

            <button
              className="login-btn-secondary"
              style={styles.buttonSecondary}
              onClick={() => { setMode("login"); resetForm(); }}
            >
              ← Back to Sign In
            </button>
          </>
        )}

        {mode === "forgot" && (
          <>
            <div style={styles.title}>Reset password</div>
            <div style={styles.subtitle}>Enter your email to receive a reset link</div>

            {error && <div style={styles.error}>{error}</div>}
            {successMsg && <div style={styles.success}>{successMsg}</div>}

            {!successMsg && (
              <form onSubmit={handleForgotPassword}>
                <div style={styles.fieldGroup}>
                  <label style={styles.label}>Email</label>
                  <input
                    className="login-input"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(""); }}
                    placeholder="you@company.com"
                    style={styles.input}
                    disabled={loading}
                    maxLength={254}
                  />
                </div>

                <button
                  type="submit"
                  className="login-btn"
                  style={styles.button}
                  disabled={loading}
                >
                  {loading ? "Sending…" : "Send Reset Link"}
                </button>
              </form>
            )}

            <button
              className="login-btn-secondary"
              style={styles.buttonSecondary}
              onClick={() => { setMode("login"); resetForm(); }}
            >
              ← Back to Sign In
            </button>
          </>
        )}

        <div style={{ marginTop: "24px", borderTop: "1px solid #1e293b", paddingTop: "16px", textAlign: "center" }}>
          <div style={{ fontSize: "11px", color: "#334155" }}>
            Protected by Firebase Authentication · TLS Encrypted
          </div>
        </div>
      </div>
    </div>
  );
}
