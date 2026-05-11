// Simple in-memory database for testing
class MemoryDB {
  constructor() {
    this.users = [];
    this.documents = [];
    this.nextUserId = 1;
    this.nextDocId = 1;
  }

  // User methods
  async findUserByEmail(email) {
    return this.users.find(user => user.email === email);
  }

  async findUserByUsername(username) {
    return this.users.find(user => user.username === username);
  }

  async findUserById(id) {
    return this.users.find(user => user.id === id);
  }

  async createUser(userData) {
    const user = {
      id: this.nextUserId++,
      ...userData,
      createdAt: new Date()
    };
    this.users.push(user);
    return user;
  }

  // Document methods
  async findDocumentsByUserId(userId) {
    return this.documents.filter(doc => doc.uploadedBy === userId);
  }

  async findDocumentById(id) {
    return this.documents.find(doc => doc.id === id);
  }

  async createDocument(docData) {
    const document = {
      id: this.nextDocId++,
      ...docData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.documents.push(document);
    return document;
  }

  async deleteDocument(id) {
    const index = this.documents.findIndex(doc => doc.id === id);
    if (index !== -1) {
      this.documents.splice(index, 1);
      return true;
    }
    return false;
  }

  async updateDocument(id, updates) {
    const doc = await this.findDocumentById(id);
    if (doc) {
      Object.assign(doc, updates, { updatedAt: new Date() });
      return doc;
    }
    return null;
  }
}

module.exports = new MemoryDB();
