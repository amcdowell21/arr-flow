import { useState, useEffect } from "react";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, getDoc,
} from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";

const ADMIN_EMAIL = "admin@uniqlearn.co";

const s = {
  page: {
    flex: 1,
    padding: "32px",
    fontFamily: "'DM Sans','Helvetica Neue',sans-serif",
    overflowY: "auto",
    maxWidth: "800px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "32px",
  },
  title: {
    fontSize: "22px",
    fontWeight: "700",
    color: "#f1f5f9",
    letterSpacing: "-0.5px",
  },
  subtitle: {
    fontSize: "13px",
    color: "#64748b",
    marginTop: "2px",
  },
  card: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "12px",
    padding: "24px",
    marginBottom: "24px",
  },
  sectionTitle: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#f1f5f9",
    marginBottom: "4px",
  },
  sectionDesc: {
    fontSize: "12px",
    color: "#64748b",
    marginBottom: "20px",
  },
  row: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
  },
  input: {
    flex: 1,
    padding: "9px 13px",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "8px",
    color: "#f1f5f9",
    fontSize: "13px",
    fontFamily: "'DM Sans',sans-serif",
    outline: "none",
  },
  btnPrimary: {
    padding: "9px 18px",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    border: "none",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "'DM Sans',sans-serif",
  },
  btnDanger: {
    padding: "5px 10px",
    background: "transparent",
    border: "1px solid rgba(239,68,68,0.4)",
    borderRadius: "6px",
    color: "#fca5a5",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: "'DM Sans',sans-serif",
    transition: "all 0.15s",
  },
  btnMuted: {
    padding: "5px 10px",
    background: "transparent",
    border: "1px solid #334155",
    borderRadius: "6px",
    color: "#64748b",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: "'DM Sans',sans-serif",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    fontSize: "11px",
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    paddingBottom: "10px",
    borderBottom: "1px solid #334155",
  },
  td: {
    padding: "12px 0",
    fontSize: "13px",
    color: "#e2e8f0",
    borderBottom: "1px solid rgba(51,65,85,0.5)",
    verticalAlign: "middle",
  },
  badge: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "99px",
    fontSize: "11px",
    fontWeight: "600",
  },
  error: {
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: "8px",
    padding: "10px 14px",
    color: "#fca5a5",
    fontSize: "13px",
    marginBottom: "12px",
  },
  success: {
    background: "rgba(74,222,128,0.12)",
    border: "1px solid rgba(74,222,128,0.3)",
    borderRadius: "8px",
    padding: "10px 14px",
    color: "#86efac",
    fontSize: "13px",
    marginBottom: "12px",
  },
  signOutBtn: {
    padding: "7px 14px",
    background: "transparent",
    border: "1px solid #334155",
    borderRadius: "8px",
    color: "#64748b",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: "'DM Sans',sans-serif",
    transition: "all 0.15s",
  },
  emptyState: {
    padding: "24px",
    textAlign: "center",
    color: "#475569",
    fontSize: "13px",
  },
};

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function AdminPanel({ currentUser, onNavigate }) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const [invites, setInvites] = useState([]);
  const [users, setUsers] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  // Real-time listeners
  useEffect(() => {
    const unsubInvites = onSnapshot(
      query(collection(db, "invitedEmails"), orderBy("invitedAt", "desc")),
      snap => setInvites(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const unsubUsers = onSnapshot(
      query(collection(db, "users"), orderBy("createdAt", "desc")),
      snap => {
        setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoadingData(false);
      }
    );
    return () => { unsubInvites(); unsubUsers(); };
  }, []);

  async function handleInvite(e) {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");

    const email = inviteEmail.trim().toLowerCase();
    if (!validateEmail(email)) {
      setInviteError("Please enter a valid email address.");
      return;
    }
    if (email === ADMIN_EMAIL) {
      setInviteError("Cannot invite the admin account.");
      return;
    }

    // Check if already invited
    const existing = invites.find(i => i.id === email);
    if (existing && !existing.used) {
      setInviteError("This email already has a pending invite.");
      return;
    }

    setInviteLoading(true);
    try {
      await setDoc(doc(db, "invitedEmails", email), {
        email,
        invitedAt: serverTimestamp(),
        invitedBy: currentUser.email,
        used: false,
      });
      setInviteSuccess(`Invite created for ${email}. Share the app URL with them — they can sign up using this email.`);
      setInviteEmail("");
    } catch (err) {
      setInviteError("Failed to create invite. Please try again.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function revokeInvite(email) {
    if (!confirm(`Revoke invite for ${email}?`)) return;
    try {
      await deleteDoc(doc(db, "invitedEmails", email));
    } catch {
      // ignore
    }
  }

  async function toggleUserActive(user) {
    if (user.email === ADMIN_EMAIL) return; // Protect admin
    const action = user.active ? "deactivate" : "reactivate";
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} account for ${user.email}?`)) return;
    try {
      await setDoc(doc(db, "users", user.id), { active: !user.active }, { merge: true });
    } catch {
      // ignore
    }
  }

  async function removeUser(user) {
    if (user.email === ADMIN_EMAIL) return;
    if (!confirm(`Remove ${user.email} from the app? This will revoke their access immediately. Their Firebase Auth account will still exist but they won't be able to access any data.`)) return;
    try {
      await deleteDoc(doc(db, "users", user.id));
      // Also clean up their invite so they can't re-register
      await deleteDoc(doc(db, "invitedEmails", user.email)).catch(() => {});
    } catch {
      // ignore
    }
  }

  async function handleSignOut() {
    await signOut(auth);
  }

  const pendingInvites = invites.filter(i => !i.used);
  const usedInvites = invites.filter(i => i.used);
  const activeUsers = users.filter(u => u.active);
  const inactiveUsers = users.filter(u => !u.active);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.title}>Admin Panel</div>
          <div style={s.subtitle}>Signed in as {currentUser?.email}</div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button style={s.signOutBtn} onClick={() => onNavigate("home")}>
            ← App
          </button>
          <button style={s.signOutBtn} onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </div>

      {/* Invite Users */}
      <div style={s.card}>
        <div style={s.sectionTitle}>Invite User</div>
        <div style={s.sectionDesc}>
          Add a user's email to allow them to create an account. They'll sign up at the app using their invited email and set their own password.
        </div>

        {inviteError && <div style={s.error}>{inviteError}</div>}
        {inviteSuccess && <div style={s.success}>{inviteSuccess}</div>}

        <form onSubmit={handleInvite}>
          <div style={s.row}>
            <input
              type="email"
              value={inviteEmail}
              onChange={e => { setInviteEmail(e.target.value); setInviteError(""); setInviteSuccess(""); }}
              placeholder="colleague@company.com"
              style={s.input}
              disabled={inviteLoading}
              maxLength={254}
            />
            <button type="submit" style={s.btnPrimary} disabled={inviteLoading}>
              {inviteLoading ? "Inviting…" : "Add Invite"}
            </button>
          </div>
        </form>
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div style={s.card}>
          <div style={s.sectionTitle}>Pending Invites ({pendingInvites.length})</div>
          <div style={s.sectionDesc}>These users have been invited but haven't created their account yet.</div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Email</th>
                <th style={s.th}>Invited</th>
                <th style={{ ...s.th, textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map(invite => (
                <tr key={invite.id}>
                  <td style={s.td}>{invite.email}</td>
                  <td style={{ ...s.td, color: "#64748b", fontSize: "12px" }}>
                    {invite.invitedAt?.toDate ? invite.invitedAt.toDate().toLocaleDateString() : "—"}
                  </td>
                  <td style={{ ...s.td, textAlign: "right" }}>
                    <button style={s.btnDanger} onClick={() => revokeInvite(invite.email)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Active Users */}
      <div style={s.card}>
        <div style={s.sectionTitle}>Active Users ({activeUsers.length})</div>
        <div style={s.sectionDesc}>Users with full access to the app.</div>
        {loadingData ? (
          <div style={s.emptyState}>Loading…</div>
        ) : activeUsers.length === 0 ? (
          <div style={s.emptyState}>No active users yet.</div>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Email</th>
                <th style={s.th}>Role</th>
                <th style={s.th}>Joined</th>
                <th style={{ ...s.th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeUsers.map(user => (
                <tr key={user.id}>
                  <td style={s.td}>
                    {user.email}
                    {user.email === currentUser?.email && (
                      <span style={{ ...s.badge, background: "rgba(99,102,241,0.2)", color: "#a5b4fc", marginLeft: "8px" }}>You</span>
                    )}
                  </td>
                  <td style={s.td}>
                    <span style={{
                      ...s.badge,
                      background: user.role === "admin" ? "rgba(99,102,241,0.2)" : "rgba(51,65,85,0.5)",
                      color: user.role === "admin" ? "#a5b4fc" : "#94a3b8",
                    }}>
                      {user.role}
                    </span>
                  </td>
                  <td style={{ ...s.td, color: "#64748b", fontSize: "12px" }}>
                    {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : "—"}
                  </td>
                  <td style={{ ...s.td, textAlign: "right" }}>
                    {user.email !== ADMIN_EMAIL && (
                      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                        <button style={s.btnMuted} onClick={() => toggleUserActive(user)}>
                          Deactivate
                        </button>
                        <button style={s.btnDanger} onClick={() => removeUser(user)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Deactivated Users */}
      {inactiveUsers.length > 0 && (
        <div style={s.card}>
          <div style={s.sectionTitle}>Deactivated Users ({inactiveUsers.length})</div>
          <div style={s.sectionDesc}>These accounts exist but are blocked from accessing the app.</div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Email</th>
                <th style={{ ...s.th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {inactiveUsers.map(user => (
                <tr key={user.id}>
                  <td style={{ ...s.td, color: "#64748b" }}>{user.email}</td>
                  <td style={{ ...s.td, textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                      <button style={s.btnMuted} onClick={() => toggleUserActive(user)}>
                        Reactivate
                      </button>
                      <button style={s.btnDanger} onClick={() => removeUser(user)}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: "11px", color: "#334155", textAlign: "center", marginTop: "8px" }}>
        User data stored in Firestore · Access enforced by security rules
      </div>
    </div>
  );
}
