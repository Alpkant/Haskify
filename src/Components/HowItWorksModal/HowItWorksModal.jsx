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
          Haskify connects a React frontend with a Node.js/Express backend.
          <br/><br/>
          <strong>Code Execution:</strong> Your Python code from the editor is sent to the backend. The server compiles and runs it using GHC, capturing the output or any compilation/runtime errors. This result is then sent back to the frontend and displayed.
          <br/><br/>
          <strong>AI Assistant:</strong> The AI assistant sends your queries, along with your current code and output, to the backend. The backend uses a language model (like DeepSeek) to generate helpful responses based on the context provided.
          <br/><br/>
          <strong>Input Handling:</strong> User input entered in the dedicated input field is sent to the backend along with the code, allowing interactive Haskell programs to receive input.
          <br/><br/>
        </p>
        <button className="close-button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
} 