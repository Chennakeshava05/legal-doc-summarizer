const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const jwt = require('jsonwebtoken');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const memoryDB = require('../utils/memoryDB');
const OpenAI = require('openai');

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOCX, and TXT files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
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

// Extract text from uploaded file
const extractTextFromFile = async (filePath, fileType) => {
  try {
    const fileBuffer = await fs.readFile(filePath);
    
    switch (fileType) {
      case 'pdf':
        const pdfData = await pdfParse(fileBuffer);
        return pdfData.text;
      
      case 'docx':
        const docxResult = await mammoth.extractRawText({ buffer: fileBuffer });
        return docxResult.value;
      
      case 'txt':
        return fileBuffer.toString('utf-8');
      
      default:
        throw new Error('Unsupported file type');
    }
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error('Failed to extract text from file');
  }
};

// Upload document
router.post('/upload', authenticateToken, upload.single('document'), async (req, res) => {
  try {
    console.log('Upload request received:', {
      file: req.file ? req.file.originalname : 'No file',
      title: req.body.title,
      user: req.user
    });

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { title } = req.body;
    const fileType = req.file.mimetype === 'application/pdf' ? 'pdf' :
                    req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'docx' : 'txt';

    console.log('File type determined:', fileType);

    // Extract text from file
    const content = await extractTextFromFile(req.file.path, fileType);
    console.log('Text extracted successfully, length:', content.length);

    // Create document record
    const document = await memoryDB.createDocument({
      title: title || req.file.originalname,
      filename: req.file.filename,
      fileType,
      content,
      uploadedBy: req.user.userId,
      processingStatus: 'processing'
    });

    // Emit real-time update
    const io = req.app.get('io');
    io.to(req.user.userId).emit('document-uploaded', {
      documentId: document.id,
      status: 'processing'
    });

    // Start processing with real OpenAI
    (async () => {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are a legal AI assistant. Create a brief but informative summary of the provided legal document. Focus on the main purpose, key terms, and important legal points."
            },
            {
              role: "user",
              content: `Document Title: ${document.title}\n\nDocument Content:\n${content.substring(0, 6000)}\n\nPlease provide a concise summary of this legal document.`
            }
          ],
          max_tokens: 300,
          temperature: 0.2
        });

        const summary = completion.choices[0].message.content;
        
        await memoryDB.updateDocument(document.id, {
          summary,
          processingStatus: 'completed',
          isProcessed: true
        });

        io.to(req.user.userId).emit('document-processed', {
          documentId: document.id,
          summary,
          status: 'completed'
        });
      } catch (error) {
        console.error('OpenAI document processing error:', error);
        // Fallback to basic summary if OpenAI fails
        const fallbackSummary = `Summary of ${document.title}: This is a legal document containing ${content.length} characters. The document appears to contain legal terms and conditions that would be analyzed in detail by an AI service.`;
        
        await memoryDB.updateDocument(document.id, {
          summary: fallbackSummary,
          processingStatus: 'completed',
          isProcessed: true
        });
        
        io.to(req.user.userId).emit('document-processed', {
          documentId: document.id,
          summary: fallbackSummary,
          status: 'completed'
        });
      }
    })();

    res.status(201).json({
      message: 'Document uploaded successfully',
      document: {
        id: document.id,
        title: document.title,
        fileType: document.fileType,
        processingStatus: document.processingStatus,
        createdAt: document.createdAt
      }
    });
  } catch (error) {
    console.error('Upload error details:', {
      message: error.message,
      stack: error.stack,
      file: req.file ? req.file.originalname : 'No file',
      body: req.body
    });
    res.status(500).json({ 
      message: 'Error uploading document',
      error: error.message 
    });
  }
});

// Get user's documents
router.get('/', authenticateToken, async (req, res) => {
  try {
    const documents = await memoryDB.findDocumentsByUserId(req.user.userId);
    const sortedDocuments = documents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Exclude content for list view
    const documentsWithoutContent = sortedDocuments.map(doc => {
      const { content, ...docWithoutContent } = doc;
      return docWithoutContent;
    });

    res.json(documentsWithoutContent);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ message: 'Error fetching documents' });
  }
});

// Get specific document
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    console.log('Fetching document with ID:', req.params.id, 'for user:', req.user.userId);
    const documentId = parseInt(req.params.id);
    
    if (isNaN(documentId)) {
      return res.status(400).json({ message: 'Invalid document ID format' });
    }
    
    const document = await memoryDB.findDocumentById(documentId);

    if (!document || document.uploadedBy !== req.user.userId) {
      console.log('Document not found or access denied');
      return res.status(404).json({ message: 'Document not found' });
    }

    console.log('Document found:', document.title);
    res.json(document);
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({ message: 'Error fetching document' });
  }
});

// Delete document
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    
    if (isNaN(documentId)) {
      return res.status(400).json({ message: 'Invalid document ID format' });
    }
    
    const document = await memoryDB.findDocumentById(documentId);

    if (!document || document.uploadedBy !== req.user.userId) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Delete from memory database
    await memoryDB.deleteDocument(documentId);

    // Delete file from filesystem
    try {
      const filePath = path.join(__dirname, '../uploads', document.filename);
      await fs.unlink(filePath);
    } catch (fileError) {
      console.error('Error deleting file:', fileError);
    }

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ message: 'Error deleting document' });
  }
});

module.exports = router;
