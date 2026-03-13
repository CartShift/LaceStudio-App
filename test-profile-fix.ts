
import { listInstagramProfileSummaries } from './src/server/services/instagram-profiles.service.ts';
listInstagramProfileSummaries().then(() => console.log('OK')).catch(console.error);

