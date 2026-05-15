const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const stream = require('stream');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// =====================================
// 1. ตั้งค่าการเชื่อมต่อ Google API
// =====================================
let auth;
if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
  auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
} else {
  auth = new google.auth.GoogleAuth({
    keyFile: './credentials.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

const drive = google.drive({ version: 'v3', auth });

// =====================================
// ⚠️ ใส่ ID โฟลเดอร์ ของคุณที่นี่ ⚠️
// =====================================
const SOURCE_FOLDER_ID = '1yS4dhnyq4OF4cf3RC5kZ8GUtXhLjIYzq'; 
const UPLOAD_FOLDER_ID = '1Qa-jz_dWndzRy50U9qlv__9S82AOPaNd'; 

// =====================================
// API: ดึงข้อมูลบุคลากร (เพิ่ม Pagination และเพิ่มขีดจำกัดไฟล์)
// =====================================
app.get('/api/getData', async (req, res) => {
  try {
    // 💡 แก้ไข: เพิ่ม pageSize เป็น 1000 เพื่อให้ดึงไฟล์ได้ครบถ้วน
    const sourceRes = await drive.files.list({
      q: `'${SOURCE_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name, webViewLink)',
      pageSize: 1000, 
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    
    const uploadRes = await drive.files.list({
      q: `'${UPLOAD_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(name)',
      pageSize: 1000,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    const submittedSet = new Set(uploadRes.data.files.map(f => f.name.replace(/\s+/g, "").toLowerCase()));
    let studentMap = {};

    sourceRes.data.files.forEach(file => {
      // 💡 ปรับปรุง: ตรวจสอบชื่อไฟล์ให้ยืดหยุ่นขึ้น (รองรับทั้งแบบมีและไม่มีจุด)
      const isT1 = /1ม\.?36/.test(file.name);
      const isT2 = /2ม\.?36/.test(file.name);
      
      if (!isT1 && !isT2) return;

      const cleanName = file.name.replace(/1ม\.?36|2ม\.?36/g, "").replace(/\.[^/.]+$/, "").replace(/\s+/g, "").trim();
      const displayName = file.name.replace(/1ม\.?36|2ม\.?36/g, "").replace(/\.[^/.]+$/, "").replace(/\s+/g, " ").trim();

      if (!studentMap[cleanName]) {
        studentMap[cleanName] = { fullName: displayName, term1: { exists: false }, term2: { exists: false } };
      }

      const fileKey = file.name.replace(/\s+/g, "").toLowerCase();
      const status = { exists: true, dlUrl: file.webViewLink, submitted: submittedSet.has(fileKey) };

      if (isT1) studentMap[cleanName].term1 = status;
      else if (isT2) studentMap[cleanName].term2 = status;
    });

    const dataArray = Object.values(studentMap).map(s => {
      s.priority = (s.term1.submitted && s.term2.submitted) ? 1 : 0;
      return s;
    });

    res.json(dataArray.sort((a, b) => a.priority - b.priority));
  } catch (error) {
    console.error("Fetch Data Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// API: อัปโหลดไฟล์ (ยังใช้ตามปกติ)
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { fileName } = req.body;
    const existing = await drive.files.list({ 
        q: `name='${fileName}' and '${UPLOAD_FOLDER_ID}' in parents and trashed=false`,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true
    });
    
    if (existing.data.files.length > 0) {
      await drive.files.delete({ fileId: existing.data.files[0].id, supportsAllDrives: true });
    }

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    await drive.files.create({
      requestBody: { name: fileName, parents: [UPLOAD_FOLDER_ID] },
      media: { mimeType: 'application/pdf', body: bufferStream },
      supportsAllDrives: true 
    });
    
    res.json({ status: 'success', message: `✅ อัปโหลดเอกสาร ${fileName} เรียบร้อย` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 เซิร์ฟเวอร์ทำงานแล้วที่ Port ${PORT}`));
