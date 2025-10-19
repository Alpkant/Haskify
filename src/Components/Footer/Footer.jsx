import React from 'react';
import './Footer.css';

export default function Footer({ onContactClick }) {
  return (
    <footer className="haskify-footer">
      <div className="footer-content">
        <button className="footer-link" onClick={onContactClick}>Contact us</button>
        <span className="copyright">All rights reserved © 2025</span>

      </div>
    </footer>
  );
}