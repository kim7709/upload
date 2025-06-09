console.log('🚀 upload-server.js 파일 실행됨');

process.on('uncaughtException', (err) => {
  console.error('🚨 Uncaught Exception:', err);
});

const mqtt = require('mqtt');
const mqttClient = mqtt.connect('mqtt://broker.hivemq.com');
mqttClient.on('connect', () => {
  console.log('✅ MQTT 연결 성공');
});

const express = require('express');
const multer = require('multer'); // multer는 선언만 되어 있음, 사용하지 않음
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;  // <--- Render용 환경변수 반영

// 업로드 폴더 설정
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 최신 이미지 반환 라우터 (가장 위에)
app.get('/images/latest', (req, res) => {
  try {
    console.log('✅ [latest] 요청 들어옴');

    const files = fs.readdirSync(uploadDir)
      .filter(f => {
        console.log('📁 파일 있음:', f);
        return f.endsWith('.jpg');
      })
      .sort((a, b) => {
        const aTime = fs.statSync(path.join(uploadDir, a)).mtime;
        const bTime = fs.statSync(path.join(uploadDir, b)).mtime;
        return bTime - aTime;
      });

    console.log('📋 필터링 후 파일 목록:', files);

    if (files.length > 0) {
      const filename = files[0];
      console.log('📄 최신 파일:', filename);

      res.sendFile(filename, {
        root: uploadDir,
        headers: { 'Content-Type': 'image/jpeg' }
      });
    } else {
      console.warn('⚠️ jpg 파일이 없습니다');
      res.status(404).send("No images available.");
    }
  } catch (err) {
    console.error('❌ /images/latest 에러:', err);
    res.status(500).send("Internal server error");
  }
});

// 요청 로그 출력
app.use((req, res, next) => {
  console.log(`📥 요청 수신됨: ${req.method} ${req.url}`);
  next();
});

// 정적 파일 제공 (index.html 등)
app.use(express.static('public'));

// multer 설정 (선언만, 실제 업로드에 사용 안함)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const filename = `image_${Date.now()}.jpg`;
    cb(null, filename);
  },
});
const upload = multer({ storage: storage });

// JPEG 업로드 받을 라우터 전용 미들웨어 (express.raw 사용)
app.use('/upload', express.raw({ type: 'image/jpeg', limit: '5mb' }));

// POST /upload - ESP32-CAM 이미지 저장
app.post('/upload', (req, res) => {
  const filename = `image_${Date.now()}.jpg`;
  const filepath = path.join(uploadDir, filename);

  fs.writeFile(filepath, req.body, err => {
    if (err) {
      console.error("❌ 이미지 저장 실패:", err);
      return res.status(500).send('Upload failed');
    }
    console.log('📸 이미지 업로드됨:', filename);
    res.send({ status: 'ok', filename });
  });
});

// GET /images/list
app.get('/images/list', (req, res) => {
  fs.readdir(uploadDir, (err, files) => {
    if (err) return res.status(500).send('Server error.');
    res.send(files.filter(f => f.endsWith('.jpg')));
  });
});

// GET /images/:name
app.get('/images/:name', (req, res) => {
  const filePath = path.join(uploadDir, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found.');
  res.sendFile(filePath);
});

// 센서 상태 저장용
let latestSensor = {
  vibration: 0,
  sound: 0,
  distance: 0,
};

// 외부 업데이트용
module.exports.setLatestSensor = (data) => {
  latestSensor = data;
};

// 센서 상태 API
app.get('/api/status', (req, res) => {
  res.json(latestSensor);
});

// 제어 명령 수신 API
app.post('/api/control', express.json(), (req, res) => {
  const { action } = req.body;
  if (!action) return res.status(400).send("No action provided");

  let topic = '';
  if (action === 'open' || action === 'close') {
    topic = 'window/control/' + action;
  } else if (action === 'lock') {
    topic = 'window/control/lock';
  } else {
    return res.status(400).send("Invalid action");
  }

  mqttClient.publish(topic, JSON.stringify({ action }));
  console.log(`📤 MQTT 제어 명령 발송: ${topic} →`, { action });
  res.send({ status: 'ok', topic, action });
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`🚀 Upload server running at http://localhost:${PORT}`);
});
