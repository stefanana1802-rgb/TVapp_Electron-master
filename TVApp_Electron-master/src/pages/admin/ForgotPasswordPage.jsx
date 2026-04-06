import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const { forgotPassword } = useAuth();
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const res = await forgotPassword(email);
      setMessage(res.message || 'Dacă acest email este înregistrat, vei primi un link de resetare.');
    } catch {
      setMessage('A apărut o eroare. Încearcă din nou.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-lg border border-gray-200 p-8">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2 text-center">Recuperare parolă</h1>
        <p className="text-sm text-gray-500 mb-6 text-center">
          Introdu email-ul contului. Link-ul de resetare va fi trimis pe email (necesită configurare server email).
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {message && <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">{message}</p>}
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
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-lg bg-gray-900 text-white font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Se trimite…' : 'Trimite link'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          <Link to="/admin/login" className="text-gray-700 hover:underline">Înapoi la autentificare</Link>
        </p>
      </div>
    </div>
  );
}
