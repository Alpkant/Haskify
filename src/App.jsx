import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './App.css';
import Header from './Components/Header/Header';
import Footer from './Components/Footer/Footer';
import UploadButton from './Components/UploadButton/UploadButton';
import PdfViewer from './Components/PdfViewer/PdfViewer';
import PythonEditor from './Components/PythonEditor/PythonEditor';
import AIAssistant from './Components/AIAssistant/AIAssistant';
import ContactModal from './Components/ContactModal/ContactModal';
import HowItWorksModal from './Components/HowItWorksModal/HowItWorksModal';
import Login from './Components/Login/Login';
import { PythonProvider } from 'react-py';

function App() {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [msgIndex, setMsgIndex] = useState(0);
  const [pdfData, setPdfData] = useState({ url: null, name: null });
  const [showUploadButton, setShowUploadButton] = useState(false);
  const [sharedState, setSharedState] = useState({
    code: `# Your Python code here
print("Welcome to Haskify! \\n Start coding now!")`,
    output: "> Ready to run Python code"
  });
  const [isContactOpen, setContactOpen] = useState(false);
  const [isHowItWorksOpen, setHowItWorksOpen] = useState(false);

  const loadingMessages = [
    "Getting things ready…",
    "Almost there…",
    "Preparing your Haskify workspace…",
    "Just a moment…"
  ];

  // Check for existing session on app load
  useEffect(() => {
    const checkSession = async () => {
      try {
        const savedUser = localStorage.getItem('haskify_user');
        if (savedUser) {
          const userData = JSON.parse(savedUser);
          
          // Verify session with backend
          const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
          const response = await fetch(`${API_BASE}/api/verify-session?userId=${userData.userId}`);
          
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              setUser(userData);
              setIsAuthenticated(true);
            } else {
              localStorage.removeItem('haskify_user');
            }
          } else {
            localStorage.removeItem('haskify_user');
          }
        }
      } catch (error) {
        console.error('Session check failed:', error);
        localStorage.removeItem('haskify_user');
      } finally {
        setLoading(false);
      }
    };

    checkSession();
  }, []);

  useEffect(() => {
    navigator.serviceWorker
      .register('/react-py-sw.js')
      .then((registration) =>
        console.log(
          'Service Worker registration successful with scope: ',
          registration.scope
        )
      )
      .catch((err) => console.log('Service Worker registration failed: ', err))
  }, [])
  
  useEffect(() => {
    if (!loading) return;
    const iv = setInterval(() => {
      setMsgIndex(i => (i + 1) % loadingMessages.length);
    }, 2000);
    return () => clearInterval(iv);
  }, [loading, loadingMessages.length]);

  const handleLogin = (userData) => {
    setUser(userData);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('haskify_user');
    localStorage.removeItem('haskify_session'); 
    sessionStorage.removeItem('haskify_session'); 
    setUser(null);
    setIsAuthenticated(false);
  };

  const handlePdfUpload = (url, name) => {
    if (pdfData.url) URL.revokeObjectURL(pdfData.url);
    setPdfData({ url, name });
  };

  const updateSharedState = (newState) => {
    setSharedState(prev => ({ ...prev, ...newState }));
  };

  // Show loading screen
  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="loading-spinner">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
        <p className="loading-text">
          {loadingMessages[msgIndex]}
        </p>
      </div>
    );
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  // Show main app if authenticated
  return (
    <PythonProvider
      packages={{
        official: ['numpy', 'matplotlib', 'pandas', 'scipy', 'scikit-learn'],
      }}
      lazy={true}
    >
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <div className="app-layout">
                <Header 
                  onHowItWorksClick={() => setHowItWorksOpen(true)}
                  user={user}
                  onLogout={handleLogout}
                />
                <main className="main-content">
                  {showUploadButton && (
                    <UploadButton onPdfUpload={handlePdfUpload} />
                  )}
                  <PdfViewer
                    pdfUrl={pdfData.url}
                    pdfName={pdfData.name}
                  />

                  <div className="code-ai-grid">
                    <div className="grid-item">
                      <h2 className="shared-title">Code Editor</h2>
                      <PythonEditor
                        sharedState={sharedState}
                        updateSharedState={updateSharedState}
                      />
                    </div>

                    <div className="grid-item">
                      <h2 className="shared-title">AI Assistant</h2>
                      <AIAssistant
                        sharedState={sharedState}
                        updateSharedState={updateSharedState}
                      />
                    </div>
                  </div>
                </main>
                <Footer onContactClick={() => setContactOpen(true)} />
                <HowItWorksModal
                  isOpen={isHowItWorksOpen}
                  onClose={() => setHowItWorksOpen(false)}
                />
                <ContactModal
                  isOpen={isContactOpen}
                  onClose={() => setContactOpen(false)}
                />
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </PythonProvider>
  );
}

export default App;
