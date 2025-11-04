import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import './PythonEditor.css';
import { usePython } from 'react-py';

let editorInstance = null;

export default function PythonEditor({ sharedState, updateSharedState }) {
  const {
    runPython,
    stdout,
    stderr,
    isLoading,
    isRunning,
    interruptExecution,
    isAwaitingInput,
    sendInput,
    prompt
  } = usePython();

  const [inputValue, setInputValue] = useState('');

  // Add debugging
  useEffect(() => {
    console.log('🔍 Python state:', { isRunning, isAwaitingInput, prompt, stdout: stdout?.substring(0, 50) });
  }, [isRunning, isAwaitingInput, prompt, stdout]);

  // Update output whenever stdout/stderr changes
  useEffect(() => {
    if (isRunning || (!isRunning && (stdout || stderr))) {
      let output = "";
      
      if (stdout) {
        output += stdout;
      }
      
      if (stderr) {
        if (output) output += '\n';
        output += stderr;
      }
      
      if (output) {
        updateSharedState({ output });
      }
    }
  }, [stdout, stderr, isRunning]);

  const handleEditorDidMount = (editor) => {
    editorInstance = editor;
  };

  const handleRunCode = async () => {
    const code = sharedState.code;
    
    if (!code || code.trim() === '') {
      updateSharedState({ output: "> No code to execute" });
      return;
    }

    // Clear previous output
    updateSharedState({ output: "> Running Python code..." });
    
    try {
      // Just run the code - output will be handled by useEffect
      await runPython(code);
      
      // Log to backend after execution completes
      setTimeout(async () => {
        const finalOutput = stdout || stderr || "> Program executed (no output)";
        await logToBackend(code, finalOutput);
      }, 100);

    } catch (error) {
      console.error('Python execution error:', error);
      const errorMsg = stderr || error.message || "Python execution failed";
      updateSharedState({ output: `> Error:\n${errorMsg}` });
    }
  };

  const logToBackend = async (code, output) => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
      const savedUser = localStorage.getItem('haskify_user');
      const userId = savedUser ? JSON.parse(savedUser).userId : null;
      
      const savedSessionId = sessionStorage.getItem('haskify_session');
      
      const response = await fetch(`${API_BASE}/api/log/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, 
          sessionId: savedSessionId,
          code: code,
          output: output
        })
      });

      if (response.ok) {
        const logResult = await response.json();
        
        if (logResult.sessionId && !savedSessionId) {
          sessionStorage.setItem('haskify_session', logResult.sessionId);
          console.log('✓ [PythonEditor] Created new session:', logResult.sessionId.substring(0, 8) + '...');
        }
      }
    } catch (logErr) {
      console.error('❌ Code execution log failed:', logErr);
    }
  };

  const handleStop = () => {
    interruptExecution();
    updateSharedState({ output: "> Execution interrupted" });
  };

  const handleInputSubmit = (e) => {
    e.preventDefault();
    console.log('📤 Sending input:', inputValue);
    if (inputValue !== undefined && inputValue !== null) {
      sendInput(inputValue);
      setInputValue('');
    }
  };

  const handleInputKeyPress = (e) => {
    if (e.key === 'Enter' && !isAwaitingInput && !isRunning) {
      e.preventDefault();
      handleRunCode();
    }
  };

  return (
    <div className="editor-container">
      <div className="editor-section">
        <Editor
          height="100%"
          language="python"
          theme="vs-dark"
          value={sharedState.code}
          onChange={(value) => updateSharedState({ code: value || '' })}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 20 },
            renderLineHighlight: 'none',
            lineDecorationsWidth: 10,
            glyphMargin: false,
            lineNumbersMinChars: 3,
            folding: false,
            autoClosingBrackets: 'always',
            formatOnType: true,
            suggestOnTriggerCharacters: true,
            tabSize: 4,
            insertSpaces: true,
            readOnly: isRunning
          }}
        />
      </div>

      {/* Optional input field when not running */}
      {!isAwaitingInput && !isRunning && (
        <div className="input-field-container">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleInputKeyPress}
            placeholder="Press Enter to run code..."
            className="program-input"
          />
        </div>
      )}

      <div className="output-section">
        <div className="output-header">
          <h3 className='output-title'>Output</h3>
          <div className="status-indicator">
            {isAwaitingInput && (
              <span className="awaiting-input-badge">
                ⏳ Waiting for input...
              </span>
            )}
            {isRunning && (
              <button 
                className="stop-button"
                onClick={handleStop}
                title="Stop execution"
              >
                Stop
              </button>
            )}
            <button 
              className="run-button"
              onClick={handleRunCode}
              disabled={isRunning || isLoading}
            >
              {isRunning ? 'Running...' : isLoading ? 'Loading Python...' : 'Run'}
            </button>
          </div>
        </div>
        <pre className="output-content">
          {sharedState.output}
        </pre>
      </div>

      {/* Real-time input prompt - MOVED TO END for proper z-index */}
      {isAwaitingInput && (
        <div className="input-prompt-overlay">
          <div className="input-prompt-box">
            <p className="input-prompt-text">
              {prompt || 'Python is waiting for input:'}
            </p>
            <form onSubmit={handleInputSubmit}>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter value..."
                className="input-prompt-field"
                autoFocus
              />
              <button type="submit" className="input-prompt-button">
                Submit
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}