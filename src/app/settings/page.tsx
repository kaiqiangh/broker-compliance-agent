'use client';


import { apiFetch } from '@/lib/api-client';
import { useEffect, useState } from 'react';

interface FirmData {
  id: string;
  name: string;
  cbiRegistration: string | null;
  subscriptionTier: string;
  subscriptionStatus: string;
}

interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  lastLoginAt: string | null;
  firm: FirmData;
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwMessage, setPwMessage] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [meRes, usersRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/users'),
        ]);

        if (meRes.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (meRes.ok) {
          const data = await meRes.json();
          setProfile(data.data);
        }

        if (usersRes.ok) {
          const data = await usersRes.json();
          setTeam(data.data);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwMessage('');
    setPwError('');

    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match');
      return;
    }
    if (newPassword.length < 10) {
      setPwError('Password must be at least 10 characters');
      return;
    }

    setPwLoading(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.error?.message || 'Failed to change password');
        return;
      }
      setPwMessage('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setPwError('Network error');
    } finally {
      setPwLoading(false);
    }
  }

  const roleLabels: Record<string, string> = {
    firm_admin: 'Admin',
    compliance_officer: 'Compliance Officer',
    adviser: 'Adviser',
    read_only: 'Read Only',
  };

  if (loading) {
    return <div className="p-8 text-gray-500">Loading settings...</div>;
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your account and firm settings</p>
      </div>

      {/* Profile */}
      {profile && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Your Profile</h2>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-gray-500">Name</label>
              <p className="text-sm text-gray-900 mt-1">{profile.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Email</label>
              <p className="text-sm text-gray-900 mt-1">{profile.email}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Role</label>
              <p className="text-sm text-gray-900 mt-1">
                {roleLabels[profile.role] || profile.role}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Last Login</label>
              <p className="text-sm text-gray-900 mt-1">
                {profile.lastLoginAt
                  ? new Date(profile.lastLoginAt).toLocaleString('en-IE')
                  : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Change Password */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Change Password</h2>
        <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Min 10 characters with uppercase, lowercase, and a digit</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          {pwError && <p className="text-sm text-red-600">{pwError}</p>}
          {pwMessage && <p className="text-sm text-green-600">{pwMessage}</p>}
          <button
            type="submit"
            disabled={pwLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {pwLoading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Firm Info */}
      {profile?.firm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Firm Information</h2>
          <div className="grid grid-cols-2 gap-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-gray-500">Firm Name</label>
              <p className="text-sm text-gray-900 mt-1">{profile.firm.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">CBI Registration</label>
              <p className="text-sm text-gray-900 mt-1">{profile.firm.cbiRegistration || '—'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Subscription</label>
              <p className="text-sm text-gray-900 mt-1 capitalize">
                {profile.firm.subscriptionTier}
                <span className="ml-2 text-xs text-gray-400">({profile.firm.subscriptionStatus})</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Team Members */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Team Members</h2>
        {team.length === 0 ? (
          <p className="text-sm text-gray-500">No team members found.</p>
        ) : (
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-sm font-medium text-gray-500">Name</th>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Email</th>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Role</th>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Status</th>
                <th className="text-left py-2 text-sm font-medium text-gray-500">Last Login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {team.map(member => (
                <tr key={member.id}>
                  <td className="py-2 text-sm">{member.name}</td>
                  <td className="py-2 text-sm text-gray-600">{member.email}</td>
                  <td className="py-2 text-sm">{roleLabels[member.role] || member.role}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      member.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {member.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-2 text-sm text-gray-500">
                    {member.lastLoginAt
                      ? new Date(member.lastLoginAt).toLocaleDateString('en-IE')
                      : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* GDPR Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Data & Privacy</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Export My Data</p>
              <p className="text-xs text-gray-500">Download all data associated with your account (GDPR Art 20)</p>
            </div>
            <a
              href="/api/gdpr?format=json"
              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
            >
              Export
            </a>
          </div>
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500">
              To request data erasure, contact your firm administrator. Erasure requests follow GDPR Art 17
              with compliance records retained under Art 17(3)(b).
            </p>
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">System</h2>
        <div className="space-y-2 text-sm text-gray-500">
          <p>BrokerComply v0.1.0 (MVP)</p>
          <p>Consumer Protection Code 2012 / CP158</p>
          <p>Regulated by the Central Bank of Ireland</p>
        </div>
      </div>
    </div>
  );
}
