
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDirectory = path.join(
  process.cwd(),
  "uploads",
  "invoice-imports"
);

// Create upload folder automatically if it does not exist
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirectory);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const uniqueName = `invoice-${Date.now()}-${Math.round(
      Math.random() * 1000000
    )}${extension}`;

    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();

  const allowedTypes = {
    ".csv": ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
    ".xlsx": [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ]
  };

  const validMimeTypes = allowedTypes[extension];

  if (!validMimeTypes || !validMimeTypes.includes(file.mimetype)) {
    return cb(
      new Error("Only CSV and XLSX files are allowed")
    );
  }

  cb(null, true);
};

const uploadInvoiceFile = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

export default uploadInvoiceFile;
