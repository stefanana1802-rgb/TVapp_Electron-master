import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext.jsx';
import App from './App.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import LoginPage from './pages/admin/LoginPage.jsx';
import RegisterPage from './pages/admin/RegisterPage.jsx';
import ForgotPasswordPage from './pages/admin/ForgotPasswordPage.jsx';
import DashboardPage from './pages/admin/DashboardPage.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

export default function Root() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/" element={<App />} />
        <Route
          path="/admin"
          element={
            <AuthProvider>
              <AdminLayout />
            </AuthProvider>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
    </ErrorBoundary>
  );
}
