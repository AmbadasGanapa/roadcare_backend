const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

const CitizenInfo = require('./models/citizen_info');
const CitizenFeedback = require('./models/citizen_feedback');
const FeedPost = require('./models/feed_post');
const SignupUser = require('./models/signup_user');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 5000);
const mongoUri = process.env.MONGO_URI;
const mailHost = String(process.env.MAIL_HOST || '').trim();
const mailPort = Number(process.env.MAIL_PORT || 587);
const mailSecure = String(process.env.MAIL_SECURE || 'false').trim().toLowerCase() === 'true';
const mailUser = String(process.env.MAIL_USER || '').trim();
const mailPass = String(process.env.MAIL_PASS || '').trim();
const mailFrom = String(process.env.MAIL_FROM || mailUser || '').trim();

let mailTransporter = null;
if (mailHost && mailUser && mailPass) {
  mailTransporter = nodemailer.createTransport({
    host: mailHost,
    port: mailPort,
    secure: mailSecure,
    auth: {
      user: mailUser,
      pass: mailPass,
    },
  });
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/', (_req, res) => {
  res.json({
    message: 'RoadCare backend is running.',
  });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const fullName = String(req.body?.fullName ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const role = String(req.body?.role ?? 'citizen').trim().toLowerCase();

    if (role !== 'citizen') {
      return res.status(400).json({ message: 'Only citizen signup is supported here.' });
    }

    if (fullName.length === 0 || email.length === 0 || password.length < 6) {
      return res.status(400).json({ message: 'Missing or invalid signup fields.' });
    }

    const existingUser = await SignupUser.findOne({ email }).lean();
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const userId = await _generateCitizenId();
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, passwordSalt, 64).toString('hex');

    const user = await SignupUser.create({
      userId,
      fullName,
      email,
      passwordHash,
      passwordSalt,
      role: 'citizen',
    });

    return res.status(201).json({
      userId: user.userId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    console.error('Failed to sign up citizen', error);
    return res.status(500).json({ message: 'Failed to sign up citizen.' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const role = String(req.body?.role ?? 'citizen').trim().toLowerCase();

    if (role !== 'citizen') {
      return res.status(400).json({ message: 'Only citizen sign in is supported here.' });
    }

    const user = await SignupUser.findOne({ email }).lean();
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const passwordHash = crypto.scryptSync(password, user.passwordSalt, 64).toString('hex');
    if (passwordHash !== user.passwordHash) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    return res.json({
      userId: user.userId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    console.error('Failed to sign in citizen', error);
    return res.status(500).json({ message: 'Failed to sign in citizen.' });
  }
});

app.get('/api/feed', async (_req, res) => {
  try {
    const roadcareComplaints = await mongoose.connection.db
      .collection('complaints')
      .find({})
      .sort({ timestamp: -1, _id: -1 })
      .toArray();

    const legacyDb = mongoose.connection.useDb('complaint_bot');
    const legacyComplaints = await legacyDb
      .collection('complaints')
      .find({})
      .sort({ timestamp: -1, _id: -1 })
      .toArray();

    const mergedComplaints = [...roadcareComplaints, ...legacyComplaints]
      .sort((a, b) => {
        const left = new Date(a?.timestamp ?? a?.createdAt ?? 0).getTime();
        const right = new Date(b?.timestamp ?? b?.createdAt ?? 0).getTime();
        return right - left;
      });

    if (mergedComplaints.length > 0) {
      return res.json(mergedComplaints.map(_mapLegacyComplaintToFeedItem));
    }

    const posts = await FeedPost.find().sort({ createdAt: -1 }).lean();

    return res.json(
      posts.map((post) => ({
        id: String(post._id),
        name: post.name,
        contactNumber: post.contactNumber || '',
        email: post.email || '',
        damageType: post.damageType,
        description: post.description,
        address: post.address,
        imageUrl: post.imageUrl || '',
        imageBase64: post.imageBase64 || '',
        latitude: typeof post.latitude === 'number' ? post.latitude : null,
        longitude: typeof post.longitude === 'number' ? post.longitude : null,
        createdAt: post.createdAt,
      })),
    );
  } catch (error) {
    console.error('Failed to fetch feed posts', error);
    res.status(500).json({
      message: 'Failed to fetch feed posts.',
    });
  }
});

app.get('/api/my-complaints', async (req, res) => {
  try {
    const citizenId = String(req.query?.citizenId ?? '').trim();
    const email = String(req.query?.email ?? '').trim().toLowerCase();

    if (citizenId.length === 0 && email.length === 0) {
      return res.status(400).json({
        message: 'citizenId or email is required.',
      });
    }

    const roadcareComplaints = await mongoose.connection.db
      .collection('complaints')
      .find({})
      .sort({ timestamp: -1, _id: -1 })
      .toArray();

    const matchedComplaints = roadcareComplaints
      .filter((doc) => {
        const user = doc && typeof doc.user === 'object' && doc.user !== null ? doc.user : null;
        const complaintCitizenId = _firstNonEmptyString([user?.citizenId, doc?.citizenId]);
        const complaintEmail = _firstNonEmptyString([user?.email]).toLowerCase();

        if (citizenId.length > 0 && complaintCitizenId === citizenId) {
          return true;
        }

        return email.length > 0 && complaintEmail === email;
      })
      .map(_mapLegacyComplaintToFeedItem);

    return res.json(matchedComplaints);
  } catch (error) {
    console.error('Failed to fetch citizen complaints', error);
    return res.status(500).json({
      message: 'Failed to fetch citizen complaints.',
    });
  }
});

function _mapLegacyComplaintToFeedItem(doc) {
  const user = doc && typeof doc.user === 'object' && doc.user !== null ? doc.user : null;
  const image = doc && typeof doc.image === 'object' && doc.image !== null ? doc.image : null;

  const name =
    _firstNonEmptyString([
      user?.name,
      user?.fullName,
      user?.username,
      user?.displayName,
      typeof doc.user === 'string' ? doc.user : '',
    ]) || 'Citizen';

  const email = _firstNonEmptyString([
    user?.email,
    user?.mail,
  ]);

  const contactNumber = _firstNonEmptyString([
    user?.contactNo,
    user?.contactNumber,
    user?.phone,
    user?.mobile,
  ]);

  const imageUrl = _firstNonEmptyString([
    image?.url,
    image?.secureUrl,
    image?.secure_url,
    image?.imageUrl,
    image?.path,
    typeof doc.image === 'string' ? doc.image : '',
  ]);

  const imageBase64 = _firstNonEmptyString([
    image?.base64,
    image?.data,
    image?.content,
  ]);

  const timestampValue = doc?.timestamp ?? doc?.createdAt ?? doc?.updatedAt;
  const upvotes = Array.isArray(doc?.upvotes) ? doc.upvotes : [];
  const comments = Array.isArray(doc?.comments) ? doc.comments : [];

  return {
    id: String(doc?._id ?? ''),
    complaintId: String(doc?._id ?? ''),
    citizenId: _firstNonEmptyString([user?.citizenId, doc?.citizenId]),
    name,
    contactNumber,
    email,
    damageType: _firstNonEmptyString([doc?.damageType, doc?.type, 'Complaint']),
    description: _firstNonEmptyString([
      doc?.description,
      doc?.issue,
      doc?.message,
      doc?.address,
      'Road complaint reported by citizen.',
    ]),
    address: _firstNonEmptyString([doc?.address, doc?.location, 'Address unavailable']),
    imageUrl,
    imageBase64,
    latitude: _toNullableNumber(doc?.latitude ?? doc?.location?.latitude ?? doc?.coords?.lat),
    longitude: _toNullableNumber(doc?.longitude ?? doc?.location?.longitude ?? doc?.coords?.lng),
    createdAt: _toIsoString(timestampValue),
    upvoteCount: upvotes.length,
    isUpvoted: false,
    comments: comments.map((comment) => ({
      author: _firstNonEmptyString([comment?.author, comment?.name, 'Citizen']),
      message: _firstNonEmptyString([comment?.message, comment?.text]),
      createdAt: _toIsoString(comment?.createdAt),
    })),
  };
}

function _firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function _toNullableNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function _toIsoString(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

async function _sendEmailIfConfigured({ to, subject, text, html }) {
  if (!mailTransporter || !mailFrom || !to) {
    return false;
  }

  await mailTransporter.sendMail({
    from: mailFrom,
    to,
    subject,
    text,
    html,
  });
  return true;
}

function _buildEmailShell({
  eyebrow,
  title,
  intro,
  accentColor,
  rows,
  footer,
}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const renderedRows = safeRows
    .map(
      (row) => `
        <tr>
          <td style="padding: 10px 0; color: #5b6472; font-size: 13px; font-weight: 600; width: 160px; vertical-align: top;">
            ${row.label}
          </td>
          <td style="padding: 10px 0; color: #172033; font-size: 14px; font-weight: 500; vertical-align: top;">
            ${row.value}
          </td>
        </tr>`,
    )
    .join('');

  return `
    <div style="margin: 0; padding: 24px 0; background: #eef3f8; font-family: Arial, Helvetica, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 640px; background: #ffffff; border: 1px solid #dbe4ee; border-radius: 18px; overflow: hidden; box-shadow: 0 12px 30px rgba(23, 32, 51, 0.08);">
              <tr>
                <td style="padding: 24px 28px; background: linear-gradient(135deg, ${accentColor} 0%, #172033 100%);">
                  <div style="font-size: 12px; letter-spacing: 1.4px; text-transform: uppercase; color: rgba(255,255,255,0.75); font-weight: 700;">
                    ${eyebrow}
                  </div>
                  <div style="margin-top: 10px; font-size: 28px; line-height: 1.2; color: #ffffff; font-weight: 700;">
                    ${title}
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding: 28px;">
                  <p style="margin: 0 0 20px; color: #334155; font-size: 15px; line-height: 1.7;">
                    ${intro}
                  </p>
                  <div style="border: 1px solid #dbe4ee; border-radius: 14px; background: #f8fbff; padding: 18px 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      ${renderedRows}
                    </table>
                  </div>
                  <p style="margin: 22px 0 0; color: #516072; font-size: 13px; line-height: 1.7;">
                    ${footer}
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>`;
}

async function _sendProfileCreatedEmail(citizen) {
  try {
    await _sendEmailIfConfigured({
      to: citizen.email,
      subject: 'RoadCare Profile Confirmation',
      text:
        `Hello ${citizen.name},\n\n` +
        'Your RoadCare profile has been created and saved successfully.\n\n' +
        `Citizen ID: ${citizen.citizenId}\n` +
        `Email: ${citizen.email}\n` +
        `City: ${citizen.city || '-'}\n` +
        `Taluka: ${citizen.taluka || '-'}\n\n` +
        'You can now continue using RoadCare to submit complaints and track your activity.\n\n' +
        'Regards,\nRoadCare Team',
      html: _buildEmailShell(
        eyebrow: 'RoadCare Citizen Profile',
        title: 'Profile Saved Successfully',
        intro:
            `Hello ${citizen.name}, your RoadCare citizen profile has been saved successfully. ` +
            'You can now continue using the app to submit road complaints and manage your account details.',
        accentColor: '#0e8f8d',
        rows: [
          { label: 'Citizen ID', value: citizen.citizenId },
          { label: 'Registered Email', value: citizen.email },
          { label: 'City', value: citizen.city || '-' },
          { label: 'Taluka', value: citizen.taluka || '-' },
        ],
        footer:
            'This is an automated confirmation from RoadCare. If you did not expect this update, please review your account information.',
      ),
    });
  } catch (error) {
    console.error('Failed to send profile email', error);
  }
}

async function _sendComplaintCreatedEmail(complaint) {
  try {
    await _sendEmailIfConfigured({
      to: complaint.email,
      subject: 'RoadCare Complaint Submission Confirmation',
      text:
        `Hello ${complaint.name},\n\n` +
        'Your complaint has been submitted successfully to RoadCare.\n\n' +
        `Complaint ID: ${complaint.id}\n` +
        `Citizen ID: ${complaint.citizenId}\n` +
        `Damage Type: ${complaint.damageType}\n` +
        `Location: ${complaint.address}\n` +
        `Timestamp: ${complaint.createdAt}\n\n` +
        'Our field team will review the report and take the necessary action.\n\n' +
        'Regards,\nRoadCare Team',
      html: _buildEmailShell(
        eyebrow: 'RoadCare Complaint Desk',
        title: 'Complaint Submitted',
        intro:
            `Hello ${complaint.name}, your complaint has been received successfully by RoadCare. ` +
            'The details below have been recorded and will be reviewed by the field team.',
        accentColor: '#dc2626',
        rows: [
          { label: 'Complaint ID', value: complaint.id },
          { label: 'Citizen ID', value: complaint.citizenId },
          { label: 'Damage Type', value: complaint.damageType },
          { label: 'Reported Location', value: complaint.address },
          { label: 'Submission Time', value: complaint.createdAt },
        ],
        footer:
            'Please keep this email for your records. You may be contacted if additional clarification is required.',
      ),
    });
  } catch (error) {
    console.error('Failed to send complaint email', error);
  }
}

app.post('/api/feed', async (req, res) => {
  try {
    const payload = {
      citizenId: String(req.body?.citizenId ?? '').trim(),
      name: String(req.body?.name ?? '').trim(),
      contactNumber: String(req.body?.contactNumber ?? '').trim(),
      email: String(req.body?.email ?? '').trim(),
      damageType: String(req.body?.damageType ?? '').trim(),
      description: String(req.body?.description ?? '').trim(),
      address: String(req.body?.address ?? '').trim(),
      imageUrl: String(req.body?.imageUrl ?? '').trim(),
      imageBase64: String(req.body?.imageBase64 ?? '').trim(),
      latitude: typeof req.body?.latitude === 'number' ? req.body.latitude : null,
      longitude: typeof req.body?.longitude === 'number' ? req.body.longitude : null,
    };

    if (
      payload.citizenId.length === 0 ||
      payload.name.length === 0 ||
      payload.contactNumber.length === 0 ||
      payload.email.length === 0 ||
      payload.damageType.length === 0 ||
      payload.description.length === 0 ||
      payload.address.length === 0
    ) {
      return res.status(400).json({
        message: 'Missing required complaint fields.',
      });
    }

    const complaintDocument = {
      citizenId: payload.citizenId,
      user: {
        citizenId: payload.citizenId,
        name: payload.name,
        email: payload.email,
        contactNo: payload.contactNumber,
      },
      address: payload.address,
      description: payload.description,
      damageType: payload.damageType,
      image: payload.imageUrl.length > 0 || payload.imageBase64.length > 0
        ? {
            url: payload.imageUrl,
            base64: payload.imageBase64,
          }
        : null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      timestamp: new Date(),
      upvotes: [],
      comments: [],
    };

    const insertResult = await mongoose.connection.db
      .collection('complaints')
      .insertOne(complaintDocument);

    const createdComplaint = await mongoose.connection.db
      .collection('complaints')
      .findOne({ _id: insertResult.insertedId });

    if (!createdComplaint) {
      throw new Error('Inserted complaint could not be loaded.');
    }

    const responseBody = {
      ..._mapLegacyComplaintToFeedItem(createdComplaint),
    };

    _sendComplaintCreatedEmail(responseBody);
    return res.status(201).json(responseBody);
  } catch (error) {
    console.error('Failed to create feed post', error);
    return res.status(500).json({
      message: 'Failed to create feed post.',
    });
  }
});

app.patch('/api/feed/:id/upvote', async (req, res) => {
  try {
    const complaint = await _findComplaintById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found.' });
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const name = String(req.body?.name ?? '').trim();
    if (email.length === 0 && name.length === 0) {
      return res.status(400).json({ message: 'Citizen identity is required.' });
    }

    const upvotes = Array.isArray(complaint.doc.upvotes) ? complaint.doc.upvotes : [];
    const existingIndex = upvotes.findIndex((entry) => {
      const entryEmail = String(entry?.email ?? '').trim().toLowerCase();
      const entryName = String(entry?.name ?? '').trim();
      return email.length > 0 ? entryEmail === email : entryName === name;
    });

    if (existingIndex >= 0) {
      upvotes.splice(existingIndex, 1);
    } else {
      upvotes.push({ email, name, createdAt: new Date() });
    }

    await complaint.collection.updateOne({ _id: complaint.doc._id }, { $set: { upvotes } });
    const updated = await complaint.collection.findOne({ _id: complaint.doc._id });
    return res.json(_mapLegacyComplaintToFeedItem(updated));
  } catch (error) {
    console.error('Failed to toggle complaint upvote', error);
    return res.status(500).json({ message: 'Failed to toggle complaint upvote.' });
  }
});

app.post('/api/feed/:id/comments', async (req, res) => {
  try {
    const complaint = await _findComplaintById(req.params.id);
    if (!complaint) {
      return res.status(404).json({ message: 'Complaint not found.' });
    }

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const name = String(req.body?.name ?? '').trim();
    const message = String(req.body?.message ?? '').trim();
    if (message.length === 0) {
      return res.status(400).json({ message: 'Comment message is required.' });
    }

    const comments = Array.isArray(complaint.doc.comments) ? complaint.doc.comments : [];
    comments.push({
      email,
      author: name.length > 0 ? name : 'Citizen',
      message,
      createdAt: new Date(),
    });

    await complaint.collection.updateOne({ _id: complaint.doc._id }, { $set: { comments } });
    const updated = await complaint.collection.findOne({ _id: complaint.doc._id });
    return res.json(_mapLegacyComplaintToFeedItem(updated));
  } catch (error) {
    console.error('Failed to add complaint comment', error);
    return res.status(500).json({ message: 'Failed to add complaint comment.' });
  }
});

async function _findComplaintById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null;
  }

  const objectId = new mongoose.Types.ObjectId(id);
  const roadcareCollection = mongoose.connection.db.collection('complaints');
  const roadcareDoc = await roadcareCollection.findOne({ _id: objectId });
  if (roadcareDoc) {
    return { collection: roadcareCollection, doc: roadcareDoc };
  }

  const legacyCollection = mongoose.connection.useDb('complaint_bot').collection('complaints');
  const legacyDoc = await legacyCollection.findOne({ _id: objectId });
  if (legacyDoc) {
    return { collection: legacyCollection, doc: legacyDoc };
  }

  return null;
}

async function _generateCitizenId() {
  const year = new Date().getFullYear();
  const counterKey = `citizen-${year}`;
  const countersCollection = mongoose.connection.db.collection('authCounters');
  await countersCollection.updateOne(
    { _id: counterKey },
    { $inc: { seq: 1 } },
    { upsert: true },
  );
  const counter = await countersCollection.findOne({ _id: counterKey });
  const serialNumber = String(counter?.seq ?? 1).padStart(4, '0');
  return `CID-${year}${serialNumber}`;
}

async function _generateFeedbackId() {
  const year = new Date().getFullYear();
  const counterKey = `feedback-${year}`;
  const countersCollection = mongoose.connection.db.collection('feedbackCounters');
  await countersCollection.updateOne(
    { _id: counterKey },
    { $inc: { seq: 1 } },
    { upsert: true },
  );
  const counter = await countersCollection.findOne({ _id: counterKey });
  const serialNumber = String(counter?.seq ?? 1).padStart(4, '0');
  return `FDB-${year}${serialNumber}`;
}

app.get('/api/citizen-info', async (req, res) => {
  try {
    const citizenId = String(req.query?.citizenId ?? '').trim();
    const email = String(req.query?.email ?? '').trim().toLowerCase();

    if (citizenId.length === 0 && email.length === 0) {
      return res.status(400).json({
        message: 'citizenId or email is required.',
      });
    }

    const query = citizenId.length > 0 ? { citizenId } : { email };
    const citizen = await CitizenInfo.findOne(query).lean();

    if (!citizen) {
      return res.status(404).json({
        message: 'Citizen info not found.',
      });
    }

    return res.json({
      citizenId: citizen.citizenId,
      name: citizen.name,
      email: citizen.email,
      contactNo: citizen.contactNo,
      dob: citizen.dob || '',
      city: citizen.city || '',
      taluka: citizen.taluka || '',
      occupation: citizen.occupation || '',
      address: citizen.address || '',
      img: citizen.img || '',
      createdAt: citizen.createdAt,
      updatedAt: citizen.updatedAt,
    });
  } catch (error) {
    console.error('Failed to fetch citizen info', error);
    return res.status(500).json({
      message: 'Failed to fetch citizen info.',
    });
  }
});

app.post('/api/citizen-info', async (req, res) => {
  try {
    const payload = {
      citizenId: String(req.body?.citizenId ?? '').trim(),
      name: String(req.body?.name ?? '').trim(),
      email: String(req.body?.email ?? '').trim().toLowerCase(),
      contactNo: String(req.body?.contactNo ?? '').trim(),
      dob: String(req.body?.dob ?? '').trim(),
      city: String(req.body?.city ?? '').trim(),
      taluka: String(req.body?.taluka ?? '').trim(),
      occupation: String(req.body?.occupation ?? '').trim(),
      address: String(req.body?.address ?? '').trim(),
      img: String(req.body?.img ?? '').trim(),
    };

    if (
      payload.citizenId.length === 0 ||
      payload.name.length === 0 ||
      payload.email.length === 0 ||
      payload.contactNo.length === 0
    ) {
      return res.status(400).json({
        message: 'Missing required citizen info fields.',
      });
    }

    const existingByEmail = await CitizenInfo.findOne({ email: payload.email }).lean();
    const lookupCitizenId =
      existingByEmail && existingByEmail.citizenId ? existingByEmail.citizenId : payload.citizenId;

    const citizen = await CitizenInfo.findOneAndUpdate(
      { citizenId: lookupCitizenId },
      payload,
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    const responseBody = {
      citizenId: citizen.citizenId,
      name: citizen.name,
      email: citizen.email,
      contactNo: citizen.contactNo,
      dob: citizen.dob || '',
      city: citizen.city || '',
      taluka: citizen.taluka || '',
      occupation: citizen.occupation || '',
      address: citizen.address || '',
      img: citizen.img || '',
      createdAt: citizen.createdAt,
      updatedAt: citizen.updatedAt,
    };

    _sendProfileCreatedEmail(responseBody);
    return res.status(201).json(responseBody);
  } catch (error) {
    console.error('Failed to save citizen info', error);
    return res.status(500).json({
      message: 'Failed to save citizen info.',
    });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const payload = {
      citizenId: String(req.body?.citizenId ?? '').trim(),
      rating: Number(req.body?.rating ?? 0),
      thoughts: String(req.body?.thoughts ?? '').trim(),
      followUp: String(req.body?.followUp ?? '').trim().toLowerCase(),
    };

    if (
      payload.citizenId.length === 0 ||
      !Number.isFinite(payload.rating) ||
      payload.rating < 1 ||
      payload.rating > 5 ||
      (payload.followUp !== 'yes' && payload.followUp !== 'no')
    ) {
      return res.status(400).json({
        message: 'Missing or invalid feedback fields.',
      });
    }

    const feedbackId = await _generateFeedbackId();
    const feedback = await CitizenFeedback.create({
      feedbackId,
      citizenId: payload.citizenId,
      rating: payload.rating,
      thoughts: payload.thoughts,
      followUp: payload.followUp,
    });

    return res.status(201).json({
      feedbackId: feedback.feedbackId,
      citizenId: feedback.citizenId,
      rating: feedback.rating,
      thoughts: feedback.thoughts,
      followUp: feedback.followUp,
      createdAt: feedback.createdAt,
    });
  } catch (error) {
    console.error('Failed to save citizen feedback', error);
    return res.status(500).json({
      message: 'Failed to save citizen feedback.',
    });
  }
});

async function startServer() {
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Add it to backend/backend/.env');
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  app.listen(port, '0.0.0.0', () => {
    console.log(`RoadCare backend listening on port ${port}`);
  });
}

startServer().catch((error) => {
  console.error('Backend startup failed', error);
  process.exit(1);
});
