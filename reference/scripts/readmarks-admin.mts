// Readmarks housekeeping, run by hand against the database named in MONGODB_URI:
//   npx tsx --env-file=.env.local scripts/readmarks-admin.mts documents            # log every listed document version not yet in the log
//   npx tsx --env-file=.env.local scripts/readmarks-admin.mts redact <index> <field>   # withdraw abusive or personal free text (the entry stays verifiable)
//   npx tsx --env-file=.env.local scripts/readmarks-admin.mts head                 # print the current checkpoint
import mongoose from 'mongoose';
const [cmd, a, b] = process.argv.slice(2);
const { logDocuments } = await import('../src/lib/readmarks/mark');
const { checkpoint } = await import('../src/lib/readmarks/log');
if (cmd === 'documents') {
  for (const d of await logDocuments()) console.log(`${d.id}: log entry ${d.index}${d.fresh ? ' (new)' : ' (already logged)'}`);
} else if (cmd === 'redact' && /^\d+$/.test(a ?? '') && b) {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const r = await mongoose.connection.db!.collection<{ _id: number }>('readmarks_text').updateOne({ _id: Number(a) }, { $unset: { [`fields.${b}`]: '' } });
  console.log(r.modifiedCount ? `withdrew "${b}" of entry ${a}; its commitment stays in the log` : 'nothing to withdraw');
} else if (cmd !== 'head') {
  console.log('usage: documents | redact <index> <field> | head');
}
console.log((await checkpoint()).note.trim());
process.exit(0);
