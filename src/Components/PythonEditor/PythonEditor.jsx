import React, { useState, useEffect } from 'react';
import AceEditor from 'react-ace';
import { usePython } from 'react-py';
import './PythonEditor.css';

// Import Ace Editor themes and modes
import 'ace-builds/src-noconflict/mode-python';
import 'ace-builds/src-noconflict/theme-monokai';
import 'ace-builds/src-noconflict/ext-language_tools';

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
  const [showOutput, setShowOutput] = useState(false);

  // Update output whenever stdout/stderr changes
  useEffect(() => {
    if (stdout || stderr) {
      let output = "";
      if (stdout) output += stdout;
      if (stderr) {
        if (output) output += '\n';
        output += stderr;
      }
      updateSharedState({ output });
      setShowOutput(true);
    }
  }, [stdout, stderr]);

  const handleRunCode = async () => {
    const code = sharedState.code;
    
    if (!code || code.trim() === '') {
      updateSharedState({ output: "> No code to execute" });
      return;
    }

    setShowOutput(false);
    updateSharedState({ output: "> Running Python code..." });
    
    try {
      await runPython(code);
      
      // Log to backend after execution
      setTimeout(async () => {
        const finalOutput = stdout || stderr || "> Program executed (no output)";
        await logToBackend(code, finalOutput);
      }, 200);

    } catch (error) {
      console.error('Python execution error:', error);
      const errorMsg = stderr || error.message || "Python execution failed";
      updateSharedState({ output: `> Error:\n${errorMsg}` });
      setShowOutput(true);
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
    setShowOutput(false);
    updateSharedState({ output: "> Execution interrupted" });
  };

  const handleInputSubmit = (e) => {
    e.preventDefault();
    if (inputValue !== undefined && inputValue !== null) {
      sendInput(inputValue);
      setInputValue('');
    }
  };

  return (
    <div className="editor-container">
      <div className="editor-section">
        <AceEditor
          mode="python"
          theme="monokai"
          value={sharedState.code}
          onChange={(value) => updateSharedState({ code: value || '' })}
          name="python-editor"
          width="100%"
          height="100%"
          fontSize={14}
          showPrintMargin={false}
          showGutter={true}
          highlightActiveLine={true}
          readOnly={isRunning}
          setOptions={{
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: true,
            enableSnippets: true,
            showLineNumbers: true,
            tabSize: 4,
            useWorker: false
          }}
          editorProps={{ $blockScrolling: true }}
        />
      </div>

      <div className="output-section">
        <div className="output-header">
          <h3 className='output-title'>Output</h3>
          <div className="status-indicator">
            {isAwaitingInput && (
              <span className="awaiting-input-badge">
                ⏳ Waiting for input...
              </span>
            )}
            {isRunning && !isAwaitingInput && (
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
        {showOutput && (
          <pre className="output-content">
            {sharedState.output}
          </pre>
        )}
      </div>

      {/* Input modal when Python calls input() */}
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