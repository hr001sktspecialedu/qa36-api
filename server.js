const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { google } = require('googleapis');
const stream = require('stream');
require('dotenv').config(); // เพิ่มตัวจัดการรหัสลับ

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// =====================================
// 1. ตั้งค่าการเชื่อมต่อ (รองรับทั้งบน Cloud และ Localhost)
// =====================================
let auth;
if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
  // กรณีรันบนเซิร์ฟเวอร์จริง (Cloud)
  auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // จัดการบรรทัดใหม่
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
} else {
  // กรณีรันบนคอมตัวเอง (Localhost)
  auth = new google.auth.GoogleAuth({
    keyFile: './credentials.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

const drive = google.drive({ version: 'v3', auth });

// =====================================
// 2. ใส่ ID โฟลเดอร์ของคุณที่ 2 บรรทัดนี้
// =====================================
const SOURCE_FOLDER_ID = '1yS4dhnyq4OF4cf3RC5kZ8GUtXhLjIYzq';
const UPLOAD_FOLDER_ID = '1Qa-jz_dWndzRy50U9qlv__9S82AOPaNd';

// API: ดึงข้อมูลบุคลากร
app.get('/api/getData', async (req, res) => {
  try {
    const sourceRes = await drive.files.list({
      q: `'${SOURCE_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name, webViewLink)',
    });
    const uploadRes = await drive.files.list({
      q: `'${UPLOAD_FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(name)',
    });

    const submittedSet = new Set(uploadRes.data.files.map(f => f.name.replace(/\s+/g, "").toLowerCase()));
    let studentMap = {};

    sourceRes.data.files.forEach(file => {
      const isT1 = file.name.includes("1ม36");
      const isT2 = file.name.includes("2ม36");
      if (!isT1 && !isT2) return;

      const cleanName = file.name.replace(/1ม36|2ม36/g, "").replace(/\.[^/.]+$/, "").replace(/\s+/g, "").trim();
      const displayName = file.name.replace(/1ม36|2ม36/g, "").replace(/\.[^/.]+$/, "").replace(/\s+/g, " ").trim();

      if (!studentMap[cleanName]) {
        studentMap[cleanName] = { fullName: displayName, term1: { exists: false }, term2: { exists: false } };
      }

      const fileKey = file.name.replace(/\s+/g, "").toLowerCase();
      const status = { exists: true, dlUrl: file.webViewLink, submitted: submittedSet.has(fileKey) };

      if (isT1) studentMap[cleanName].term1 = status;
      else studentMap[cleanName].term2 = status;
    });

    const dataArray = Object.values(studentMap).map(s => {
      s.priority = (s.term1.submitted && s.term2.submitted) ? 1 : 0;
      return s;
    });
    res.json(dataArray.sort((a, b) => a.priority - b.priority));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: อัปโหลดไฟล์
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { fileName } = req.body;
    
    const existing = await drive.files.list({ q: `name='${fileName}' and '${UPLOAD_FOLDER_ID}' in parents and trashed=false` });
    if (existing.data.files.length > 0) {
      await drive.files.delete({ fileId: existing.data.files[0].id });
    }

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    await drive.files.create({
      requestBody: { name: fileName, parents: [UPLOAD_FOLDER_ID] },
      media: { mimeType: 'application/pdf', body: bufferStream },
    });
    
    res.json({ status: 'success', message: `✅ อัปโหลดเอกสาร ${fileName} เรียบร้อย` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// กำหนด Port ให้รองรับ Cloud
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 เซิร์ฟเวอร์ทำงานแล้วที่ Port ${PORT}`));