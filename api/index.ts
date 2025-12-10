import SFTP from "ssh2-sftp-client";
import supabase from "../lib/supabaseClient";

function mapOrderType(productCode: string): string {
  const mapping: Record<string, string> = {
   
    "Hemleverans kväll 17-22": "kvällsleverans",
    "Ombud/ Paketskåpsleverans": "ombud"
  };
  return mapping[productCode] || "okänd";
}

export default async function handler(req, res) {
  const client = new SFTP();

  try {
    await client.connect({
      host: process.env.SFTP_HOST,
      port: 22,
      username: process.env.SFTP_USER,
      password: process.env.SFTP_PASSWORD
    });

    const files = await client.list("/incoming");
    const processedOrders = [];

    for (const file of files) {
      if (!file.name.endsWith(".json")) continue;

      const filePath = `/incoming/${file.name}`;
      const buffer = await client.get(filePath);
      const json = JSON.parse(buffer.toString());

      // Hitta mottagaren
      const receiver = json.parties.find((p: any) => p.type === "receiver");
      const packageInfo = json.packages?.[0];

      // Transformera till ditt format
      const order = {
        order_type: mapOrderType(json.product_code),
        name: receiver?.name || "",
        address1: receiver?.address1 || "",
        order_id: json.shipment_number,
        status: "kommande",
        postalnumber: receiver?.postal_code || "",
        city: receiver?.city || "",
        numberofkollin: packageInfo?.number || 1,
        source: "shipmondo"
      };

      // Spara till Supabase
      const { error } = await supabase.from("orders").insert(order);

      if (error) {
        console.error("Supabase error:", error);
      } else {
        processedOrders.push(order);
        // Flytta processad fil
        await client.rename(filePath, `/processed/${file.name}`);
      }
    }

    await client.end();

    return res.status(200).json({
      count: processedOrders.length,
      orders: processedOrders
    });

  } catch (err) {
    console.error("SFTP ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
}