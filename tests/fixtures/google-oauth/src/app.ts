import { google } from 'googleapis';
const gmail = google.gmail({ version: 'v1' });
gmail.users.messages.send({ userId: 'me', requestBody: { raw: 'synthetic-example' } });
const drive = google.drive('v3');
drive.files.get({ fileId: 'synthetic-file' });
const calendar = google.calendar('v3');
calendar.events.insert({ calendarId: 'primary', requestBody: { summary: 'Synthetic example' } });
