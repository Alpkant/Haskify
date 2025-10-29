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
            const res = await fetch(`${import.meta.env.VITE_API_URL}/api/contact`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            });
            if (res.ok) {
              alert('Message sent!');
              onClose();
            } else {
              alert('Failed to send message.');
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
            <textarea required />
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
