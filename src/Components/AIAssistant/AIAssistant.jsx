import React, { useState, useEffect, useRef } from "react";
import "./AIAssistant.css";
import blackStars from "../../assets/blackStars.png";
import arrowIcon from "../../assets/arrow.png";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { tomorrow } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function AIAssistant({ sharedState, updateSharedState }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const [materialIds, setMaterialIds] = useState([]); 
  const [uploadStatus, setUploadStatus] = useState(null); 
  const messagesEndRef = useRef(null);
  const typingIntervalRef = useRef(null);
  const sessionHistoryRef = useRef([]);
  const sessionIdRef = useRef(null);
  const fileInputRef = useRef(null); 

  // Helper to sync sessionId from sessionStorage before requests
  const syncSessionId = () => {
    const savedSessionId = sessionStorage.getItem('haskify_session');
    if (savedSessionId && savedSessionId !== sessionIdRef.current) {
      sessionIdRef.current = savedSessionId;
      console.log('🔄 [AIAssistant] Synced session from storage:', savedSessionId.substring(0, 8) + '...');
    }
    return sessionIdRef.current;
  };

  useEffect(() => {
    const initialMessage =
      "Hi! How can I help you with your Python project today?";
    let currentIndex = 0;

    setIsTyping(true);
    setMessages([{ sender: "OUR AI", text: "", isTyping: true }]);

    typingIntervalRef.current = setInterval(() => {
      if (currentIndex < initialMessage.length) {
        setMessages([
          {
            sender: "OUR AI",
            text: initialMessage.substring(0, currentIndex + 1),
            isTyping: true,
          },
        ]);
        currentIndex++;
      } else {
        clearInterval(typingIntervalRef.current);
        setMessages([
          {
            sender: "OUR AI",
            text: initialMessage,
            isTyping: false,
          },
        ]);
        setIsTyping(false);
        sessionHistoryRef.current.push({
          question: null,
          response: initialMessage,
          time: new Date().toISOString(),
        });
      }
    }, 15);

    return () => clearInterval(typingIntervalRef.current);
  }, []);

  // Load or keep sessionId from sessionStorage on mount
  useEffect(() => {
    const savedSessionId = sessionStorage.getItem('haskify_session');
    if (savedSessionId) {
      sessionIdRef.current = savedSessionId;
      console.log('✓ [AIAssistant] Loaded existing session:', savedSessionId.substring(0, 8) + '...');
    } else {
      console.log('⚠️ [AIAssistant] No session found - will create on first interaction');
    }
  }, []);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, uploadStatus]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (sessionHistoryRef.current.length > 0) {
        const API_BASE =
          import.meta.env.VITE_API_URL || "http://localhost:5001";
        const blob = new Blob(
          [JSON.stringify({ session: sessionHistoryRef.current })],
          { type: "application/json" }
        );
        navigator.sendBeacon(`${API_BASE}/api/save-session`, blob);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const handleGenerateQuiz = async () => {
    if (isQuizLoading || isLoading || isTyping) return;
    setIsQuizLoading(true);

    setMessages((prev) => [
      ...prev,
      { sender: "OUR AI", text: "", isLoading: true },
    ]);

    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
      const res = await fetch(`${API_BASE}/api/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          chatHistory: sessionHistoryRef.current, 
          sessionId: syncSessionId()
        }),
      });
      const quiz = await res.json();

      setMessages((prev) => prev.filter((msg) => !msg.isLoading));

      setMessages((prev) => [
        ...prev,
        { sender: "OUR AI", type: "quiz", payload: quiz },
      ]);
    } catch {
      setMessages((prev) => {
        const withoutLoad = prev.filter((m) => !m.isLoading);
        return [
          ...withoutLoad,
          {
            sender: "OUR AI",
            type: "error",
            text: "❌ Failed to generate quiz. Please try again.",
          },
        ];
      });
    } finally {
      setIsQuizLoading(false);
    }
  };

  const pickFiles = () => fileInputRef.current?.click();

  const handleFilesSelected = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
    
    // Get userId from localStorage
    const savedUser = localStorage.getItem('haskify_user');
    const userId = savedUser ? JSON.parse(savedUser).userId : null;

    for (const file of files) {
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("sessionId", syncSessionId());
        form.append("userId", userId);

        setUploadStatus(`Uploading ${file.name}...`);

        const res = await fetch(`${API_BASE}/api/upload-material`, {
          method: "POST",
          body: form,
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "upload failed");
        }
        
        const data = await res.json();

        if (data.materialId) {
          setMaterialIds((prev) => [
            ...prev,
            { id: data.materialId, title: data.title || file.name },
          ]);
          setUploadStatus(`✓ ${data.title || file.name} uploaded (${data.chunks} chunks)`);
          setTimeout(() => setUploadStatus(null), 3000);
        } else {
          setUploadStatus(`✗ Couldn't attach ${file.name}`);
          setTimeout(() => setUploadStatus(null), 2500);
        }
      } catch (error) {
        console.error('Upload error:', error);
        setUploadStatus(`✗ ${error.message || `Couldn't attach ${file.name}`}`);
        setTimeout(() => setUploadStatus(null), 3000);
      }
    }

    e.target.value = "";
  };

  const removeMaterial = (id) => {
    setMaterialIds((prev) => prev.filter((m) => m.id !== id));
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || isTyping) return;
    setIsLoading(true);
    setMessages((prev) => [...prev, { sender: "ME", text: input }]);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { sender: "OUR AI", text: "", isLoading: true },
    ]);
    sessionHistoryRef.current.push({
      question: input,
      response: null,
      time: new Date().toISOString(),
    });
    await sendToBackend(input);
    setIsLoading(false);
  };

  const sendToBackend = async (query) => {
    try {
      const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
      
      // Get userId from localStorage
      const savedUser = localStorage.getItem('haskify_user');
      const userId = savedUser ? JSON.parse(savedUser).userId : null;
      
      const response = await fetch(`${API_BASE}/ai/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          code: sharedState.code,
          output: sharedState.output,
          materialIds: materialIds.map((m) => m.id),
          userId, // Add this back
          sessionId: syncSessionId()
        }),
      });

      if (!response.ok) throw new Error("Network response was not ok");
      const data = await response.json();

      // Handle sessionId from response
      if (data.sessionId && !syncSessionId()) {
        sessionIdRef.current = data.sessionId;
        sessionStorage.setItem('haskify_session', data.sessionId);
        console.log('✓ [AIAssistant] Created and saved new session:', data.sessionId.substring(0, 8) + '...');
      }

      // remove loading bubble
      setMessages((prev) => prev.filter((msg) => !msg.isLoading));

      setIsTyping(true);
      let currentIndex = 0;
      const responseText = data.response;
      setMessages((prev) => [
        ...prev,
        { sender: "OUR AI", text: "", isTyping: true },
      ]);

      typingIntervalRef.current = setInterval(() => {
        if (currentIndex < responseText.length) {
          setMessages((prev) => {
            const base = prev.slice(0, -1);
            return [
              ...base,
              {
                sender: "OUR AI",
                text: responseText.substring(0, currentIndex + 1),
                isTyping: true,
              },
            ];
          });
          currentIndex++;
        } else {
          clearInterval(typingIntervalRef.current);
          setMessages((prev) => {
            const base = prev.slice(0, -1);
            return [
              ...base,
              { sender: "OUR AI", text: responseText, isTyping: false },
            ];
          });
          setIsTyping(false);
          // update session history
          const last = sessionHistoryRef.current.slice(-1)[0];
          if (last && last.response === null) last.response = responseText;
          const payload = { session: sessionHistoryRef.current };
          // save or patch session
          if (!syncSessionId()) {
            fetch(`${API_BASE}/api/save-session`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
              .then((res) => res.json())
              .then((data) => {
                if (data.success && data.id) {
                  sessionIdRef.current = data.id;
                  sessionStorage.setItem('haskify_session', data.id);
                  console.log('✓ [AIAssistant] Saved session:', data.id.substring(0, 8) + '...');
                }
              });
          } else {
            fetch(`${API_BASE}/api/save-session/${syncSessionId()}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
          }
        }
      }, 15);
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => {
        const filtered = prev.filter((msg) => !msg.isLoading);
        return [
          ...filtered,
          {
            sender: "OUR AI",
            text: "⚠️ Error connecting to AI. Please try again later.",
            isTyping: false,
          },
        ];
      });
      setIsLoading(false);
      setIsTyping(false);
      const last = sessionHistoryRef.current.slice(-1)[0];
      if (last && last.response === null)
        last.response = "⚠️ Error connecting to AI. Please try again later.";
    }
  };

  const formatMessage = (text) => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, i) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const code = part.replace(/```(\w+)?\n?|\n?```/g, "").trim();
        const language = part.match(/```(\w+)/)?.[1] || "text";
        return (
          <div key={i} className="code-block-container">
            <SyntaxHighlighter
              language={language}
              style={tomorrow}
              customStyle={{
                background: "#282c34",
                borderRadius: "6px",
                padding: "12px",
                margin: "8px 0",
                fontSize: "0.8em",
                maxHeight: "300px",
                overflow: "auto",
              }}
              showLineNumbers
              wrapLines
            >
              {code}
            </SyntaxHighlighter>
            {language === "python" && (
              <button
                className="apply-code-button"
                onClick={() =>
                  updateSharedState({ code: code, changedLines: [] })
                }
              >
                Apply Code
              </button>
            )}
          </div>
        );
      }
      return (
        <div key={i}>
          {part.split("\n").map((line, j) => (
            <div key={j}>{line}</div>
          ))}
        </div>
      );
    });
  };

  return (
    <div className="ai-assistant">
      <div className="ai-header">
        <img src={blackStars} alt="Python Logo" className="ai-logo" />
        <p className="ai-subheader">Ask our AI anything</p>
        <button
          className="generate-quiz-button"
          onClick={handleGenerateQuiz}
          disabled={isQuizLoading || isLoading || isTyping}
        >
          {isQuizLoading ? "Loading…" : "Generate Quiz"}
        </button>
      </div>

      <div className="chat-container">
        {messages.map((message, idx) => {
          if (message.type === "quiz") {
            const { question, choices, correctIndex } = message.payload;
            const selected = message.selected;
            return (
              <div key={idx}>
                <div className="message-sender">
                  <img
                    src={blackStars}
                    alt="AI Logo"
                    className="ai-logo-chat"
                  />
                  OUR AI
                </div>
                <div className="message-text quiz-bubble">
                  <p className="quiz-question">{question}</p>
                  {choices.map((c, i) => (
                    <button
                      key={i}
                      className={`quiz-choice ${
                        selected != null
                          ? i === selected
                            ? i === correctIndex
                              ? "correct"
                              : "incorrect"
                            : i === correctIndex
                            ? "correct"
                            : ""
                          : ""
                      }`}
                      disabled={selected != null}
                      onClick={async () => {
                        // Update UI first
                        setMessages((prev) =>
                          prev.map((m, j) =>
                            j === idx ? { ...m, selected: i } : m
                          )
                        );
                        
                        // Log to backend
                        const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
                        const savedUser = localStorage.getItem('haskify_user');
                        const userId = savedUser ? JSON.parse(savedUser).userId : null;
                        
                        try {
                          await fetch(`${API_BASE}/api/log/quiz`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              userId: userId,
                              sessionId: syncSessionId(),
                              quizQuestion: question,
                              quizChoices: choices,
                              correctAnswer: correctIndex,
                              selectedAnswer: i
                            })
                          });
                          console.log(`Quiz answer logged: ${i === correctIndex ? 'Correct' : 'Incorrect'}`);
                        } catch (error) {
                          console.error('Failed to log quiz answer:', error);
                        }
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          if (message.type === "error") {
            return (
              <div key={idx}>
                <div className="message-sender">
                  <img
                    src={blackStars}
                    alt="AI Logo"
                    className="ai-logo-chat"
                  />
                  OUR AI
                </div>
                <div className="message-text error-bubble">{message.text}</div>
              </div>
            );
          }

          return (
            <div key={idx}>
              <div className="message-sender">
                {message.sender === "OUR AI" && (
                  <>
                    <img
                      src={blackStars}
                      alt="AI Logo"
                      className="ai-logo-chat"
                    />
                    {message.sender}
                    {message.isLoading && (
                      <span className="loading-indicator"></span>
                    )}
                  </>
                )}
                {message.sender === "ME" && message.sender}
              </div>
              <div className="message-text">
                {formatMessage(message.text)}
                {message.isTyping && !message.isLoading && (
                  <span className="typing-cursor">|</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Inline (non-bubble) upload status under the last message */}
        {uploadStatus && (
          <div className="upload-status" aria-live="polite">
            {uploadStatus}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        {/* Attached materials as chips */}
        {materialIds.length > 0 && (
          <div className="attachments-bar">
            {materialIds.map((m) => (
              <span key={m.id} className="attachment-chip" title={m.title}>
                <span className="chip-title">{m.title}</span>
                <button
                  className="chip-remove"
                  onClick={() => removeMaterial(m.id)}
                  aria-label={`Remove ${m.title}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me anything about your projects"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={isLoading || isTyping}
        />

        {/* Hidden multi-file input */}
        <input
          type="file"
          accept="application/pdf,application/python,.py"
          multiple
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleFilesSelected}
        />

        {/* Plus (attach) button */}
        <button
          className="attach-button"
          type="button"
          onClick={pickFiles}
          disabled={isLoading || isTyping}
          title="Attach PDFs or Python code"
        >
          +
        </button>

        <img
          src={arrowIcon}
          alt="Send"
          className="send-icon"
          onClick={handleSend}
          style={{
            opacity: isLoading || isTyping ? 0.5 : 1,
            cursor: isLoading || isTyping ? "not-allowed" : "pointer",
          }}
        />
      </div>
    </div>
  );
}
