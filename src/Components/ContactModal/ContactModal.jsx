import React from 'react';
import './ContactModal.css';

export default function ContactModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>Contact Us</h2>
        <form
          onSubmit={async e => {
            e.preventDefault();
            const data = {
              name: e.target[0].value,
              email: e.target[1].value,
              message: e.target[2].value,
            };
            
            // Fix: Add proper fallback like other components
            const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
            
            try {
              const res = await fetch(`${API_BASE}/api/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              });
              
              if (res.ok) {
                alert('Message sent!');
                e.target.reset();
                onClose();
              } else {
                const error = await res.json();
                alert('Failed to send message: ' + (error.error || 'Unknown error'));
              }
            } catch (err) {
              console.error('Contact error:', err);
              alert('Network error. Make sure backend is running at ' + API_BASE);
            }
          }}
        >
          <label>
            Name/User Id:
            <input type="text" required />
          </label>
          <label>
            Email:
            <input type="email" required />
          </label>
          <label>
            Message:
            <textarea required minLength={10} />
          </label>
          <div className="modal-actions">
            <button type="submit">Send</button>
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </form>
      </div>
    </div>
  );
}
