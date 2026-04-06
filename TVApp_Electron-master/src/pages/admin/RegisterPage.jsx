import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Parolele nu coincid.');
      return;
    }
    if (password.length < 6) {
      setError('Parola trebuie să aibă cel puțin 6 caractere.');
      return;
    }
    setLoading(true);
    const res = await register(email, password);
    setLoading(false);
    if (res.ok) navigate('/admin/login', { replace: true });
    else setError(res.error || 'Înregistrare eșuată');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-lg border border-gray-200 p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6 text-center">Admin – Înregistrare</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Parolă</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmă parola</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Se încarcă…' : 'Înregistrare'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          Ai deja cont? <Link to="/admin/login" className="text-gray-700 hover:underline">Autentificare</Link>
        </p>
      </div>
    </div>
  );
}
