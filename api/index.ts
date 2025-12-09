import SFTP from "ssh2-sftp-client";

export default async function handler(req, res) {
  const client = new SFTP();

  try {
    // 1. Koppla upp
    await client.connect({
  host: process.env.SFTP_HOST,
  port: 22,
  username: process.env.SFTP_USER,
  password: process.env.SFTP_PASSWORD
});


    // 2. Lista alla filer i incoming
    const files = await client.list("/incoming");

    const orders = [];

    for (const file of files) {
      if (!file.name.endsWith(".json")) continue;

      const filePath = `/incoming/${file.name}`;

      // 3. Läs filens innehåll
      const buffer = await client.get(filePath);
      const json = JSON.parse(buffer.toString());

      orders.push({
        filename: file.name,
        data: json
      });

      // 4. (Valfritt) flytta filen efter läsning
      // await client.rename(filePath, `/processed/${file.name}`);
    }

    await client.end();

    return res.status(200).json({
      count: orders.length,
      orders
    });

  } catch (err) {
    console.error("SFTP ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}
