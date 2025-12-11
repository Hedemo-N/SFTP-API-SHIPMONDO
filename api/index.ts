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
  console.log("🚀 API anropad:", new Date().toISOString());
  
  const client = new SFTP();

  try {
    console.log("📡 Försöker ansluta till SFTP...");
    console.log("Host:", process.env.SFTP_HOST);
    console.log("User:", process.env.SFTP_USER);
    
    await client.connect({
      host: process.env.SFTP_HOST,
      port: 22,
      username: process.env.SFTP_USER,
      password: process.env.SFTP_PASSWORD
    });
    
    console.log("✅ SFTP ansluten!");

    console.log("📂 Listar filer i /incoming...");
    const files = await client.list("/incoming");
    console.log("📄 Hittade filer:", files.map(f => f.name));
    
    const processedOrders = [];

    for (const file of files) {
      if (!file.name.endsWith(".json")) {
        console.log("⏭️ Hoppar över (inte JSON):", file.name);
        continue;
      }

      console.log("📖 Läser fil:", file.name);
      const filePath = `/incoming/${file.name}`;
      const buffer = await client.get(filePath);
      const json = JSON.parse(buffer.toString());
      console.log("📦 Order ID:", json.id, "Shipment:", json.shipment_number);

      const sender = json.parties.find((p: any) => p.type === "sender");
      const receiver = json.parties.find((p: any) => p.type === "receiver");
      const packageInfo = json.packages?.[0];

      // Slå upp butik i profiles baserat på display_name
      console.log("🔍 Söker efter butik:", sender?.name);
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("_id")
        .eq("display_name", sender?.name)
        .single();

      if (profileError) {
        console.error("⚠️ Kunde inte hitta butik:", profileError.message);
      } else {
        console.log("✅ Hittade butik med _id:", profile._id);
      }

      const order = {
  order_type: mapOrderType(json.product_code),
  name: receiver?.name || "",
  address1: receiver?.address1 || "",
  order_id: json.shipment_number,
  status: "kommande",
  postalnumber: receiver?.postal_code || "",
  city: receiver?.city || "",
  numberofkollin: packageInfo?.number || 1,
  source: "shipmondo",
  user_id: profile?._id || null,
  phone: receiver?.phone || ""
};
      
      console.log("💾 Sparar till Supabase:", order);

      const { error } = await supabase.from("orders").insert(order);

      if (error) {
        console.error("❌ Supabase error:", error);
      } else {
        console.log("✅ Order sparad!");
        processedOrders.push(order);
        
        console.log("📁 Flyttar fil till /processed...");
        await client.rename(filePath, `/processed/${file.name}`);
        console.log("✅ Fil flyttad!");
      }
    }

    await client.end();
    console.log("🏁 Klar! Processade:", processedOrders.length, "ordrar");

    return res.status(200).json({
      count: processedOrders.length,
      orders: processedOrders
    });

  } catch (err) {
    console.error("💥 FEL:", err);
    await client.end().catch(() => {});
    return res.status(500).json({ error: err.message });
  }
}