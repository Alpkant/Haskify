import React from 'react';
import './Header.css';
import logo from '../../assets/logo.png';
import { Link } from 'react-router-dom';


export default function Header({ onHowItWorksClick }) {
  return (
    <header className="haskify-header">
      <div className="header-content">
        <div className="logo-container">
          <Link to="/" className="logo-container" style={{ textDecoration: 'none' }}>
            <img src={logo} alt="Haskify Logo" className="logo" />
            <span className="app-name">Haskify</span>
          </Link>
        </div>
      
        <nav className="header-nav">
          <a href="/" className="nav-link">Home</a>
          <button onClick={onHowItWorksClick} className="nav-link-button">How Does It Work?</button>
        </nav>
        <div className="user-info">
        <span className="user-id">User: {user?.userId}</span>
        <button onClick={onLogout} className="logout-button">
          Logout
        </button>
      </div>
      </div>
    </header>
  );
}