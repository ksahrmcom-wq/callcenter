import React, { useState } from 'react';
import {
  Shield,
  Lock,
  LogIn,
  UserPlus,
  Trash2,
  CheckCircle2,
  XCircle,
  Users,
  AlertCircle,
  Sun,
  Moon,
  UserCheck,
  Database,
  RefreshCw,
  Plus,
  Pencil,
  Check,
  X,
  RotateCcw,
} from 'lucide-react';
import {
  ROLE_DEFINITIONS,
  canRolePerform,
  validateUserRegistrationInput,
  validatePasswordResetInput,
  DEFAULT_RBAC_MATRIX,
  normalizeRbacActionKey,
} from '../utils/sipEngine';
import { sendFirebasePasswordReset } from '../lib/firebase';
import type {
  RolePermissionUser,
  UserRole,
  RbacPermissionEntry,
} from '../types/sip';

interface AuthGateScreenProps {
  users: RolePermissionUser[];
  isDark: boolean;
  onToggleDark: () => void;
  onLoginSuccess: (user: RolePermissionUser) => void;
  onGoogleLogin?: () => Promise<void>;
}

export const AuthGateScreen: React.FC<AuthGateScreenProps> = ({
  isDark,
  onToggleDark,
  onLoginSuccess,
}) => {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      if (mode === 'forgot') {
        const validation = validatePasswordResetInput({
          email,
          newPassword,
          confirmPassword,
        });
        if (!validation.valid) {
          setError(validation.errors[0] || 'Invalid password reset details');
          setLoading(false);
          return;
        }
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, newPassword, confirmPassword }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to reset password');
        }
        await sendFirebasePasswordReset(email).catch(() => false);
        setPassword(newPassword);
        setSuccessMsg(
          data.message ||
            `Password for ${email} has been reset and saved to Firebase. Click "Sign In to Console" below to continue.`
        );
        setMode('login');
      } else {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Authentication failed');
        }
        if (data.user) {
          onLoginSuccess(data.user);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to process request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Minimal Security Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-sky-500" />
          <div>
            <span className="text-base font-bold tracking-tight font-display text-slate-900 dark:text-slate-100">
              VoxPulse SIP
            </span>
            <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 ml-2">
              Enterprise VoIP & Automated Voice Platform · Mandatory User Authentication & Firebase RBAC Gate
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleDark}
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Main Centered Authentication Gate */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-10">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Authenticated Session Required</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  <Database className="w-3.5 h-3.5" />
                  <span>Firebase Cloud Synced</span>
                </div>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {mode === 'login'
                  ? 'Sign in to VoxPulse SIP Console'
                  : 'Reset User Password in Firebase'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {mode === 'forgot'
                  ? 'Enter your registered email address and choose a new password. Your updated credentials will be encrypted and automatically saved in Firebase.'
                  : 'This platform cannot be accessed without an authenticated user account. All user accounts, roles, and password changes are automatically saved in Firebase.'}
              </p>
            </div>

            {/* Mode Switcher Tabs: Sign In | Forgot Password */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                User Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('forgot');
                  setError(null);
                  setSuccessMsg(null);
                }}
                className={`py-2 px-3 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  mode === 'forgot'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Forgot Password
              </button>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-400 flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div
                role="status"
                className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Work Email Address
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="operator@voxpulse.io"
                  className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>

              {mode === 'login' ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        setError(null);
                        setSuccessMsg(null);
                      }}
                      className="text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="auth-new-password"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      New Password
                    </label>
                    <input
                      id="auth-new-password"
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="auth-confirm-password"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                    >
                      Confirm New Password
                    </label>
                    <input
                      id="auth-confirm-password"
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                {mode === 'login' ? (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>{loading ? 'Authenticating...' : 'Sign In to Console'}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    <span>
                      {loading
                        ? 'Updating Password in Firebase...'
                        : 'Reset Password & Save to Firebase'}
                    </span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

// --- USERS & ROLES MANAGEMENT VIEW (SIDEBAR SECTION) ---

interface UsersAndRolesViewProps {
  users: RolePermissionUser[];
  activeUser: RolePermissionUser;
  rbacMatrix: RbacPermissionEntry[];
  onAddUser: (payload: {
    name: string;
    email: string;
    role: UserRole;
    department?: string;
    password?: string;
  }) => Promise<void>;
  onUpdateUser: (
    userId: string,
    payload: { role?: UserRole; status?: 'Active' | 'Invited' | 'Suspended'; department?: string }
  ) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
  onSwitchActiveUser: (user: RolePermissionUser) => void;
  onAddPermission: (payload: {
    label: string;
    category: string;
    action?: string;
    roles: Record<UserRole, boolean>;
  }) => Promise<void>;
  onUpdatePermission: (
    permissionId: string,
    payload: {
      label?: string;
      category?: string;
      action?: string;
      roles?: Record<UserRole, boolean>;
    }
  ) => Promise<void>;
  onDeletePermission: (permissionId: string) => Promise<void>;
  onResetPermissions: () => Promise<void>;
}

const DOMAIN_PRESETS = [
  'Voice Operations',
  'Campaigns & Media',
  'Infrastructure',
  'Monitoring & Audit',
  'Administration',
];

export const UsersAndRolesView: React.FC<UsersAndRolesViewProps> = ({
  users,
  activeUser,
  rbacMatrix,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
  onSwitchActiveUser,
  onAddPermission,
  onUpdatePermission,
  onDeletePermission,
  onResetPermissions,
}) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('VoxPulse#2026');
  const [department, setDepartment] = useState('Voice Operations');
  const [role, setRole] = useState<UserRole>('operator');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Add Permission Matrix State
  const [newPermLabel, setNewPermLabel] = useState('');
  const [newPermCategory, setNewPermCategory] = useState('Voice Operations');
  const [newPermAction, setNewPermAction] = useState('');
  const [newPermRoles, setNewPermRoles] = useState<Record<UserRole, boolean>>({
    admin: true,
    manager: true,
    operator: false,
    viewer: false,
  });

  // Inline Edit Permission Matrix State
  const [editingPermId, setEditingPermId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editAction, setEditAction] = useState('');
  const [editRoles, setEditRoles] = useState<Record<UserRole, boolean>>({
    admin: true,
    manager: false,
    operator: false,
    viewer: false,
  });

  const effectiveMatrix =
    Array.isArray(rbacMatrix) && rbacMatrix.length > 0 ? rbacMatrix : DEFAULT_RBAC_MATRIX;
  const canManageUsers = canRolePerform(activeUser.role, 'manage_users_and_roles', effectiveMatrix);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!canManageUsers) {
      setFeedback({
        type: 'err',
        text: `Your current role (${activeUser.role.toUpperCase()}) does not have permission to create or modify users. Switch to Admin to manage users.`,
      });
      return;
    }
    const check = validateUserRegistrationInput({
      name,
      email,
      password,
      role,
      requirePassword: true,
    });
    if (!check.valid) {
      setFeedback({ type: 'err', text: check.errors[0] || 'Invalid user details' });
      return;
    }
    try {
      await onAddUser({
        name: name.trim(),
        email: email.trim(),
        role,
        department: department.trim() || 'Operations',
        password,
      });
      setName('');
      setEmail('');
      setFeedback({
        type: 'ok',
        text: `User account ${email.trim()} created with role ${role.toUpperCase()} and synced.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to create user' });
    }
  };

  const handleRoleChange = async (targetUser: RolePermissionUser, newRole: UserRole) => {
    setFeedback(null);
    if (!canManageUsers) {
      setFeedback({
        type: 'err',
        text: 'Only System Administrators (admin) can change user roles.',
      });
      return;
    }
    try {
      await onUpdateUser(targetUser.id, { role: newRole });
      setFeedback({
        type: 'ok',
        text: `Updated ${targetUser.name}'s role to ${newRole.toUpperCase()}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to update role' });
    }
  };

  const handleStatusToggle = async (targetUser: RolePermissionUser) => {
    setFeedback(null);
    if (!canManageUsers) {
      setFeedback({
        type: 'err',
        text: 'Only System Administrators (admin) can suspend or activate users.',
      });
      return;
    }
    const nextStatus = targetUser.status === 'Suspended' ? 'Active' : 'Suspended';
    try {
      await onUpdateUser(targetUser.id, { status: nextStatus });
      setFeedback({
        type: 'ok',
        text: `User ${targetUser.name} status changed to ${nextStatus}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to update status' });
    }
  };

  const handleRemoveUser = async (targetUser: RolePermissionUser) => {
    setFeedback(null);
    if (!canManageUsers) {
      setFeedback({
        type: 'err',
        text: 'Only System Administrators (admin) can delete users.',
      });
      return;
    }
    try {
      await onDeleteUser(targetUser.id);
      setFeedback({
        type: 'ok',
        text: `Removed user ${targetUser.name} (${targetUser.email}).`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete user' });
    }
  };

  const handleAddPermissionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const trimmedLabel = newPermLabel.trim();
    const trimmedCat = newPermCategory.trim() || 'Voice Operations';
    const computedAction = normalizeRbacActionKey(newPermAction.trim() || trimmedLabel);
    if (trimmedLabel.length < 3) {
      setFeedback({
        type: 'err',
        text: 'Capability / Security Action label must be at least 3 characters.',
      });
      return;
    }
    try {
      await onAddPermission({
        label: trimmedLabel,
        category: trimmedCat,
        action: computedAction,
        roles: newPermRoles,
      });
      setNewPermLabel('');
      setNewPermAction('');
      setFeedback({
        type: 'ok',
        text: `Added capability "${trimmedLabel}" (${computedAction}) to the RBAC Permission Matrix and saved to Firebase.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to add permission' });
    }
  };

  const handleStartEditPerm = (row: RbacPermissionEntry) => {
    setEditingPermId(row.id);
    setEditLabel(row.label);
    setEditCategory(row.category);
    setEditAction(row.action);
    setEditRoles({ ...row.roles });
  };

  const handleSaveEditPerm = async (rowId: string) => {
    setFeedback(null);
    if (editLabel.trim().length < 3) {
      setFeedback({
        type: 'err',
        text: 'Capability / Security Action label must be at least 3 characters.',
      });
      return;
    }
    try {
      await onUpdatePermission(rowId, {
        label: editLabel.trim(),
        category: editCategory.trim() || 'Voice Operations',
        action: normalizeRbacActionKey(editAction.trim() || editLabel.trim()),
        roles: editRoles,
      });
      setEditingPermId(null);
      setFeedback({
        type: 'ok',
        text: `Updated permission "${editLabel.trim()}" in the RBAC Permission Matrix and synced to Firebase.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to update permission' });
    }
  };

  const handleToggleRoleCell = async (row: RbacPermissionEntry, targetRole: UserRole) => {
    setFeedback(null);
    const nextValue = !row.roles[targetRole];
    const updatedRoles: Record<UserRole, boolean> = {
      ...row.roles,
      [targetRole]: nextValue,
    };
    try {
      await onUpdatePermission(row.id, { roles: updatedRoles });
      setFeedback({
        type: 'ok',
        text: `${nextValue ? 'Granted' : 'Revoked'} "${row.label}" for role ${targetRole.toUpperCase()}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to toggle role permission' });
    }
  };

  const handleRemovePermission = async (row: RbacPermissionEntry) => {
    setFeedback(null);
    try {
      await onDeletePermission(row.id);
      if (editingPermId === row.id) {
        setEditingPermId(null);
      }
      setFeedback({
        type: 'ok',
        text: `Deleted permission "${row.label}" from the RBAC Permission Matrix and Firebase.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete permission' });
    }
  };

  const handleResetMatrix = async () => {
    setFeedback(null);
    try {
      await onResetPermissions();
      setEditingPermId(null);
      setFeedback({
        type: 'ok',
        text: 'Restored default 13-action RBAC Permission Matrix and synced to Firebase.',
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to reset RBAC matrix' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Current Session Identity */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Users & Role-Based Access Control (RBAC)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage platform users, assign 4-tier security roles (Admin, Manager, Operator, Viewer), and add, edit, or delete RBAC matrix capabilities
          </p>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
          <UserCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <div>
            <span className="text-slate-500 dark:text-slate-400">Signed in as: </span>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {activeUser.name}
            </span>
            <span className="ml-2 font-mono font-bold uppercase text-sky-600 dark:text-sky-400">
              [{activeUser.role}]
            </span>
          </div>
        </div>
      </div>

      {/* Role Tier Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(['admin', 'manager', 'operator', 'viewer'] as UserRole[]).map((r) => {
          const def = ROLE_DEFINITIONS[r];
          const count = users.filter((u) => u.role === r).length;
          const allowedCount = effectiveMatrix.filter((m) => m.roles[r]).length;
          const isCurrentRole = activeUser.role === r;
          return (
            <div
              key={r}
              className={`bg-white dark:bg-slate-900 border rounded-xl p-4 space-y-2 ${
                isCurrentRole
                  ? 'border-sky-500'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider font-mono text-sky-600 dark:text-sky-400">
                  {def.badgeLabel}
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {count} {count === 1 ? 'user' : 'users'} · {allowedCount}/{effectiveMatrix.length} perms
                </span>
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {def.title}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {def.summary}
              </p>
            </div>
          );
        })}
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create New User & Assign Role Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-sky-500" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Create User Account & Assign Role
            </h3>
          </div>
          {!canManageUsers && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              Read-Only Mode: Switch to an Admin account below to add or edit users
            </span>
          )}
        </div>

        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label
              htmlFor="new-user-name"
              className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
            >
              Full Name
            </label>
            <input
              id="new-user-name"
              type="text"
              required
              disabled={!canManageUsers}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sarah Jenkins"
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="new-user-email"
              className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
            >
              Email Address
            </label>
            <input
              id="new-user-email"
              type="email"
              required
              disabled={!canManageUsers}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@voxpulse.io"
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="new-user-dept"
              className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
            >
              Department
            </label>
            <input
              id="new-user-dept"
              type="text"
              disabled={!canManageUsers}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="Voice Operations"
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="new-user-password"
              className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
            >
              Initial Password
            </label>
            <input
              id="new-user-password"
              type="text"
              required
              disabled={!canManageUsers}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="new-user-role"
              className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
            >
              Assigned Role
            </label>
            <select
              id="new-user-role"
              disabled={!canManageUsers}
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 disabled:opacity-50"
            >
              <option value="admin">Admin (Full Control)</option>
              <option value="manager">Manager (Campaigns & IVR)</option>
              <option value="operator">Operator (Calls & Callback)</option>
              <option value="viewer">Viewer (Read-Only Auditor)</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={!canManageUsers}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add User</span>
            </button>
          </div>
        </form>
      </div>

      {/* Registered Users Directory & Role Assignment Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-500" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Platform Users Directory ({users.length})
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Change roles inline or click &ldquo;Switch Session&rdquo; to test the app as that user
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/60">
                <th className="py-3 px-4">User & Email</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Assigned Role (RBAC)</th>
                <th className="py-3 px-4">Account Status</th>
                <th className="py-3 px-4">Last Active</th>
                <th className="py-3 px-4 text-right">Session & Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {users.map((u) => {
                const isCurrent = u.id === activeUser.id;
                return (
                  <tr
                    key={u.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <span>{u.name}</span>
                        {isCurrent && (
                          <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                            (Current Session)
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                        {u.email}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                      {u.department || 'Voice Operations'}
                    </td>

                    <td className="py-3 px-4">
                      <select
                        aria-label={`Change role for ${u.name}`}
                        disabled={!canManageUsers}
                        value={u.role}
                        onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                        className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      >
                        <option value="admin">ADMIN — System Administrator</option>
                        <option value="manager">MANAGER — Campaign Manager</option>
                        <option value="operator">OPERATOR — SIP Call Operator</option>
                        <option value="viewer">VIEWER — Compliance Auditor</option>
                      </select>
                    </td>

                    <td className="py-3 px-4">
                      <button
                        type="button"
                        disabled={!canManageUsers}
                        onClick={() => handleStatusToggle(u)}
                        className={`font-mono font-semibold cursor-pointer disabled:cursor-default ${
                          u.status === 'Suspended'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {u.status || 'Active'}
                      </button>
                    </td>

                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {u.lastActive}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!isCurrent && u.status !== 'Suspended' && (
                          <button
                            type="button"
                            onClick={() => onSwitchActiveUser(u)}
                            className="py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                          >
                            Switch Session
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!canManageUsers}
                          onClick={() => handleRemoveUser(u)}
                          aria-label={`Delete user ${u.name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive Role-Based Access Control (RBAC) Permission Matrix (Add, Edit, Delete) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Role-Based Access Control (RBAC) Permission Matrix ({effectiveMatrix.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Add new security capabilities, click any role cell to toggle permissions, or edit and delete matrix rows
            </p>
          </div>

          <button
            type="button"
            onClick={handleResetMatrix}
            className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Default Matrix</span>
          </button>
        </div>

        {/* Add New RBAC Permission Form */}
        <form
          onSubmit={handleAddPermissionSubmit}
          className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40 space-y-3"
        >
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-sky-500" />
            <span>Add New Capability to RBAC Permission Matrix</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            <div className="lg:col-span-4">
              <label
                htmlFor="rbac-new-label"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Capability / Security Action
              </label>
              <input
                id="rbac-new-label"
                type="text"
                required
                value={newPermLabel}
                onChange={(e) => setNewPermLabel(e.target.value)}
                placeholder="e.g. Audit Live RTP Audio Streams"
                className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="lg:col-span-2">
              <label
                htmlFor="rbac-new-category"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Domain
              </label>
              <input
                id="rbac-new-category"
                type="text"
                list="rbac-domain-presets"
                required
                value={newPermCategory}
                onChange={(e) => setNewPermCategory(e.target.value)}
                placeholder="Voice Operations"
                className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
              <datalist id="rbac-domain-presets">
                {DOMAIN_PRESETS.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>

            <div className="lg:col-span-2">
              <label
                htmlFor="rbac-new-action"
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Action Key (Optional)
              </label>
              <input
                id="rbac-new-action"
                type="text"
                value={newPermAction}
                onChange={(e) => setNewPermAction(e.target.value)}
                placeholder={
                  newPermLabel
                    ? normalizeRbacActionKey(newPermLabel)
                    : 'audit_live_rtp_streams'
                }
                className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="lg:col-span-2">
              <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Allowed Roles
              </span>
              <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800">
                {(['admin', 'manager', 'operator', 'viewer'] as UserRole[]).map((r) => (
                  <label
                    key={r}
                    className="flex items-center gap-1 text-[11px] font-mono uppercase text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={newPermRoles[r]}
                      onChange={(e) =>
                        setNewPermRoles((prev) => ({ ...prev, [r]: e.target.checked }))
                      }
                      className="rounded border-slate-300 dark:border-slate-700 cursor-pointer"
                    />
                    <span>{r.slice(0, 3)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="lg:col-span-2">
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Permission</span>
              </button>
            </div>
          </div>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/60">
                <th className="py-3 px-4">Capability / Security Action</th>
                <th className="py-3 px-4">Domain</th>
                <th className="py-3 px-4 text-center">Admin</th>
                <th className="py-3 px-4 text-center">Manager</th>
                <th className="py-3 px-4 text-center">Operator</th>
                <th className="py-3 px-4 text-center">Viewer</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {effectiveMatrix.map((row) => {
                const isEditing = editingPermId === row.id;

                if (isEditing) {
                  return (
                    <tr
                      key={row.id}
                      className="bg-sky-500/5 dark:bg-sky-500/10"
                    >
                      <td className="py-2.5 px-4 space-y-1.5">
                        <input
                          type="text"
                          aria-label="Edit capability label"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
                        />
                        <input
                          type="text"
                          aria-label="Edit action key"
                          value={editAction}
                          onChange={(e) => setEditAction(e.target.value)}
                          className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-mono text-slate-600 dark:text-slate-300"
                        />
                      </td>
                      <td className="py-2.5 px-4">
                        <input
                          type="text"
                          aria-label="Edit capability domain"
                          list="rbac-domain-presets"
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className="w-full rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                        />
                      </td>
                      {(['admin', 'manager', 'operator', 'viewer'] as UserRole[]).map((r) => (
                        <td key={r} className="py-2.5 px-4 text-center">
                          <input
                            type="checkbox"
                            aria-label={`Allow ${r} for ${editLabel}`}
                            checked={Boolean(editRoles[r])}
                            onChange={(e) =>
                              setEditRoles((prev) => ({
                                ...prev,
                                [r]: e.target.checked,
                              }))
                            }
                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 cursor-pointer"
                          />
                        </td>
                      ))}
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveEditPerm(row.id)}
                            aria-label={`Save changes for ${row.label}`}
                            className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPermId(null)}
                            aria-label="Cancel editing permission"
                            className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {row.label}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        {row.action}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                      {row.category}
                    </td>
                    {(['admin', 'manager', 'operator', 'viewer'] as UserRole[]).map((r) => {
                      const allowed = Boolean(row.roles?.[r]);
                      return (
                        <td key={r} className="py-2.5 px-4 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleRoleCell(row, r)}
                            aria-label={`Toggle ${r} permission for ${row.label} (currently ${
                              allowed ? 'Allowed' : 'Denied'
                            })`}
                            title={`Click to ${allowed ? 'revoke' : 'grant'} ${
                              row.label
                            } for ${r.toUpperCase()}`}
                            className="p-1 rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer inline-flex items-center justify-center"
                          >
                            {allowed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <XCircle className="w-4 h-4 text-slate-300 dark:text-slate-700" />
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleStartEditPerm(row)}
                          aria-label={`Edit permission ${row.label}`}
                          className="py-1 px-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 text-xs font-medium cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemovePermission(row)}
                          aria-label={`Delete permission ${row.label}`}
                          className="py-1 px-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/30 inline-flex items-center gap-1 text-xs font-medium cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
