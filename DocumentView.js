import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { 
  DocumentTextIcon, 
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  DocumentDuplicateIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import ReactMarkdown from 'react-markdown';
import toast from 'react-hot-toast';

const DocumentView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socket, connected } = useSocket();
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchDocument();
    if (socket) {
      socket.emit('join-room', `${localStorage.getItem('userId')}-${id}`);
      
      socket.on('qa-started', (data) => {
        setIsProcessing(true);
        setChatHistory(prev => [...prev, {
          type: 'user',
          content: data.question,
          timestamp: data.timestamp
        }]);
      });

      socket.on('qa-response', (data) => {
        setIsProcessing(false);
        setChatHistory(prev => [...prev, {
          type: 'assistant',
          content: data.answer,
          timestamp: data.timestamp
        }]);
      });

      socket.on('summary-started', (data) => {
        setIsGeneratingSummary(true);
      });

      socket.on('summary-completed', (data) => {
        setIsGeneratingSummary(false);
        setDocument(prev => ({
          ...prev,
          summary: data.summary,
          processingStatus: 'completed'
        }));
        toast.success('Summary generated successfully!');
      });

      return () => {
        socket.off('qa-started');
        socket.off('qa-response');
        socket.off('summary-started');
        socket.off('summary-completed');
      };
    }
  }, [id, socket]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const fetchDocument = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/documents/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setDocument(data);
      } else if (response.status === 404) {
        toast.error('Document not found');
        navigate('/');
      }
    } catch (error) {
      console.error('Error fetching document:', error);
      toast.error('Error loading document');
    } finally {
      setLoading(false);
    }
  };

  const handleAskQuestion = async (e) => {
    e.preventDefault();
    
    if (!question.trim()) {
      toast.error('Please enter a question');
      return;
    }

    if (!connected) {
      toast.error('Connection lost. Please refresh the page.');
      return;
    }

    setIsProcessing(true);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/qa/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          documentId: id,
          question: question.trim()
        })
      });

      if (response.ok) {
        setQuestion('');
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to process question');
        setIsProcessing(false);
      }
    } catch (error) {
      console.error('Error asking question:', error);
      toast.error('Error processing question');
      setIsProcessing(false);
    }
  };

  const handleGenerateSummary = async () => {
    if (!connected) {
      toast.error('Connection lost. Please refresh the page.');
      return;
    }

    setIsGeneratingSummary(true);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/qa/summarize/${id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.message || 'Failed to generate summary');
        setIsGeneratingSummary(false);
      }
    } catch (error) {
      console.error('Error generating summary:', error);
      toast.error('Error generating summary');
      setIsGeneratingSummary(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-yellow-100 text-yellow-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="spinner h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading document...</p>
        </div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="text-center py-12">
        <ExclamationTriangleIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-600">Document not found</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 btn-primary"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/')}
                className="text-gray-500 hover:text-gray-700"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{document.title}</h1>
                <div className="flex items-center space-x-4 mt-1">
                  <span className="text-sm text-gray-500">
                    {document.fileType.toUpperCase()} • {new Date(document.createdAt).toLocaleDateString()}
                  </span>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(document.processingStatus)}`}>
                    {document.processingStatus}
                  </span>
                  <div className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                </div>
              </div>
            </div>
            <button
              onClick={handleGenerateSummary}
              disabled={isGeneratingSummary || document.processingStatus !== 'completed'}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingSummary ? (
                <div className="flex items-center">
                  <div className="spinner h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                  Generating...
                </div>
              ) : (
                <div className="flex items-center">
                  <DocumentDuplicateIcon className="h-4 w-4 mr-2" />
                  Generate Summary
                </div>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Document Content */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <DocumentTextIcon className="h-5 w-5 mr-2" />
              Document Content
            </h2>
          </div>
          <div className="p-6">
            <div className="prose max-w-none">
              <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
                  {document.content.substring(0, 5000)}
                  {document.content.length > 5000 && '\n\n... (content truncated for display)'}
                </pre>
              </div>
            </div>
          </div>
        </div>

        {/* Q&A Interface */}
        <div className="bg-white rounded-lg shadow flex flex-col h-[600px]">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <ChatBubbleLeftRightIcon className="h-5 w-5 mr-2" />
              AI Q&A Assistant
            </h2>
          </div>

          {/* Chat History */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {chatHistory.length === 0 ? (
              <div className="text-center py-8">
                <ChatBubbleLeftRightIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">Ask a question about this document</p>
                <p className="text-sm text-gray-500 mt-1">
                  I'll help you understand the legal content
                </p>
              </div>
            ) : (
              chatHistory.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      msg.type === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-800'
                    }`}
                  >
                    <ReactMarkdown className="text-sm">{msg.content}</ReactMarkdown>
                    <p className="text-xs mt-1 opacity-70">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))
            )}
            
            {isProcessing && (
              <div className="flex justify-start">
                <div className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <div className="spinner h-4 w-4 border-2 border-gray-600 border-t-transparent"></div>
                    <span className="text-sm">Thinking...</span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={chatEndRef} />
          </div>

          {/* Question Input */}
          <div className="px-6 py-4 border-t border-gray-200">
            <form onSubmit={handleAskQuestion} className="flex space-x-2">
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about this document..."
                className="flex-1 form-input"
                disabled={isProcessing || !connected}
              />
              <button
                type="submit"
                disabled={isProcessing || !connected || !question.trim()}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <div className="spinner h-4 w-4 border-2 border-white border-t-transparent"></div>
                ) : (
                  'Send'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Summary Section */}
      {document.summary && (
        <div className="bg-white rounded-lg shadow mt-6">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Document Summary</h2>
          </div>
          <div className="p-6">
            <div className="prose max-w-none">
              <ReactMarkdown>{document.summary}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentView;
