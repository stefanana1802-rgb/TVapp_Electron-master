import React from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';

const PUBLIC_PATHS = ['/admin/login', '/admin/register', '/admin/forgot-password'];

export default function AdminLayout() {
  const { user, checking } = useAuth();
  const location = useLocation();
  const isPublic = PUBLIC_PATHS.includes(location.pathname);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Se încarcă…</p>
      </div>
    );
  }

  if (!user && !isPublic) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
