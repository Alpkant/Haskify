import React, { useState } from 'react';
import './Login.css';

export default function Login({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!userId.trim()) {
      setError('Please enter your User ID');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: userId.trim() }),
      });

      const data = await response.json();

      if (data.success) {
        // Store user session
        localStorage.setItem('haskify_user', JSON.stringify(data.user));
        onLogin(data.user);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img src="/logo.png" alt="Haskify" className="login-logo" />
          <h1 className="login-title">Welcome to Haskify</h1>
          <p className="login-subtitle">Enter your User ID to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label htmlFor="userId" className="input-label">User ID</label>
            <input
              type="text"
              id="userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Enter your assigned User ID"
              className="input-field"
              disabled={isLoading}
              autoFocus
            />
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={isLoading || !userId.trim()}
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <div className="login-footer">
          <p className="help-text">
            Don't have a User ID or having trouble logging in? <br />Contact <a href="mailto:kantarci@em.uni-frankfurt.de">kantarci@em.uni-frankfurt.de</a>.
          </p>
        </div>
      </div>
    </div>
  );
}