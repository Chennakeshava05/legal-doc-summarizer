const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const memoryDB = require('../utils/memoryDB');
const OpenAI = require('openai');

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Ask question about a document
router.post('/ask', authenticateToken, [
  body('documentId').notEmpty().withMessage('Document ID is required'),
  body('question').trim().isLength({ min: 1 }).withMessage('Question is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { documentId, question } = req.body;
    const docId = parseInt(documentId);

    if (isNaN(docId)) {
      return res.status(400).json({ message: 'Invalid document ID format' });
    }

    console.log('Processing question for document ID:', docId, 'user:', req.user.userId);

    // Find the document
    const document = await memoryDB.findDocumentById(docId);

    if (!document || document.uploadedBy !== req.user.userId) {
      console.log('Document not found for Q&A:', docId);
      return res.status(404).json({ message: 'Document not found' });
    }

    // Emit real-time response generation
    const io = req.app.get('io');
    const roomId = `${req.user.userId}-${documentId}`;
    
    // Start processing the question
    io.to(roomId).emit('qa-started', {
      question,
      timestamp: new Date()
    });

    // Real OpenAI response generation
    (async () => {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are a legal AI assistant. Analyze the provided legal document content and answer questions accurately based on the document text. Provide professional, clear, and helpful responses about legal terms, obligations, and document content."
            },
            {
              role: "user",
              content: `Document Title: ${document.title}\n\nDocument Content:\n${document.content.substring(0, 8000)}\n\nQuestion: ${question}\n\nPlease answer this question based on the provided document content.`
            }
          ],
          max_tokens: 500,
          temperature: 0.3
        });

        const response = completion.choices[0].message.content;

        io.to(roomId).emit('qa-response', {
          question,
          answer: response,
          timestamp: new Date()
        });
      } catch (error) {
        console.error('OpenAI API error:', error);
        // Fallback to simulated response if OpenAI fails
        const fallbackResponse = `I apologize, but I'm unable to process your question with the AI service at the moment. Based on the document "${document.title}", this appears to be a legal document containing ${document.content.length} characters. Please try again or rephrase your question.`;

        io.to(roomId).emit('qa-response', {
          question,
          answer: fallbackResponse,
          timestamp: new Date()
        });
      }
    })();

    res.json({
      message: 'Question received, processing...',
      roomId
    });
  } catch (error) {
    console.error('Q&A error:', error);
    res.status(500).json({ message: 'Error processing question' });
  }
});

// Get chat history for a document
router.get('/history/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    const docId = parseInt(documentId);

    if (isNaN(docId)) {
      return res.status(400).json({ message: 'Invalid document ID format' });
    }

    // Verify document exists and belongs to user
    const document = await memoryDB.findDocumentById(docId);

    if (!document || document.uploadedBy !== req.user.userId) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // In production, you would store chat history in a separate collection
    // For now, return an empty array as we're not persisting chat history
    res.json({
      documentId,
      history: [],
      message: 'Chat history feature would be implemented with persistent storage'
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({ message: 'Error fetching chat history' });
  }
});

// Generate document summary
router.post('/summarize/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    const docId = parseInt(documentId);

    if (isNaN(docId)) {
      return res.status(400).json({ message: 'Invalid document ID format' });
    }

    // Find the document
    const document = await memoryDB.findDocumentById(docId);

    if (!document || document.uploadedBy !== req.user.userId) {
      console.log('Document not found for summarization:', docId);
      return res.status(404).json({ message: 'Document not found' });
    }

    // Emit real-time summary generation
    const io = req.app.get('io');
    const roomId = `${req.user.userId}-${documentId}`;
    
    io.to(roomId).emit('summary-started', {
      documentId,
      timestamp: new Date()
    });

    // Real OpenAI summary generation
    (async () => {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are a legal AI assistant. Create a comprehensive executive summary of the provided legal document. Include key points, obligations, terms, rights, and any important considerations. Be professional and concise."
            },
            {
              role: "user",
              content: `Document Title: ${document.title}\n\nDocument Content:\n${document.content.substring(0, 8000)}\n\nPlease provide a comprehensive executive summary of this legal document.`
            }
          ],
          max_tokens: 600,
          temperature: 0.2
        });

        const summary = completion.choices[0].message.content;

        // Update document with summary
        await memoryDB.updateDocument(docId, {
          summary,
          processingStatus: 'completed',
          isProcessed: true
        });

        io.to(roomId).emit('summary-completed', {
          documentId,
          summary,
          timestamp: new Date()
        });
      } catch (error) {
        console.error('OpenAI summary error:', error);
        // Fallback to simulated summary if OpenAI fails
        const fallbackSummary = `Executive Summary of "${document.title}":

This document is a legal text containing ${document.content.length} characters. Key points include:
• Legal obligations and responsibilities
• Terms and conditions
• Rights and remedies
• Compliance requirements
• Risk factors and considerations

Note: AI summary service is currently unavailable. This is a basic summary.`;

        await memoryDB.updateDocument(docId, {
          summary: fallbackSummary,
          processingStatus: 'completed',
          isProcessed: true
        });

        io.to(roomId).emit('summary-completed', {
          documentId,
          summary: fallbackSummary,
          timestamp: new Date()
        });
      }
    })();

    res.json({
      message: 'Summary generation started',
      roomId
    });
  } catch (error) {
    console.error('Summary generation error:', error);
    res.status(500).json({ message: 'Error generating summary' });
  }
});

module.exports = router;
