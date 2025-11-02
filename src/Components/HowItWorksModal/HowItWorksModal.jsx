import React from 'react';
import './HowItWorksModal.css';

export default function HowItWorksModal({ isOpen, onClose }) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>How does it work?</h2>
        <p>
          Haskify helps you learn and experiment with Python code more easily.

          <br /><br />
          <strong>What Haskify Does:</strong>
          <br />
          <strong>1. Run Python Code:</strong> You can write and edit Python code. When you click Run, your code is executedand the output or errors are shown instantly.
          <br /><br />
          <strong>2. Get AI Help:</strong> You can ask the built-in AI Assistant questions about Python, your code, or general programming. The assistant provides short, helpful hints based on your code, uploaded materials, and follow-up questions.
          <br /><br />
          <strong>3. Upload Materials:</strong> You can attach your own Python files or PDFs as extra reference. The AI will use these materials to answer your questions more specifically.
          <br /><br />
          
        </p>
        <button className="close-button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
} 