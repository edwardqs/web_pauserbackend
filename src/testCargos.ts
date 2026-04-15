import "dotenv/config";
import axios from "axios";

async function main() {
  try {
    const res = await axios.get("http://localhost:3000/api/references/cargos", {
      headers: { Authorization: "Bearer test" }
    });
    console.log("Cargos:", res.data.slice(0, 5));
  } catch (e: any) {
    console.log("Error:", e.message);
  }
}

main();