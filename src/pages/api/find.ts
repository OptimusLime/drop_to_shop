import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = locals.runtime;
  const env = runtime.env as { GEMINI_API_KEY: string };

  const form = await request.formData();
  const file = form.get('image') as File | null;

  if (!file) {
    return Response.json({ error: 'No image provided' }, { status: 400 });
  }

  const imageBytes = new Uint8Array(await file.arrayBuffer());
  
  // Chunk the conversion to avoid stack overflow on large images
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < imageBytes.length; i += chunkSize) {
    const chunk = imageBytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);

  // Step 1: Use Gemini to identify the product
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: file.type,
                data: base64
              }
            },
            {
              text: `Identify this product. Return ONLY a JSON object with:
- "name": the product name (brand + product + variant/flavor if visible)
- "searchQuery": optimized Amazon search query (shorter, key terms only)

Example: {"name":"Culture Pop Strawberry Rhubarb Probiotic Soda","searchQuery":"Culture Pop Strawberry Rhubarb Soda"}

Return ONLY valid JSON, no other text.`
            }
          ]
        }]
      })
    }
  );

  if (!res.ok) {
    const error = await res.text();
    console.error('Gemini API error:', error);
    return Response.json({ error: `Gemini API error: ${error}` }, { status: 500 });
  }

  const json = await res.json();
  console.log('=== GEMINI RESPONSE ===');
  console.log(JSON.stringify(json, null, 2));
  
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    return Response.json({ error: 'No response from Gemini' }, { status: 500 });
  }

  let productInfo;
  try {
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
    productInfo = JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse:', text);
    return Response.json({ error: 'Failed to parse product info', raw: text }, { status: 500 });
  }

  console.log('=== PRODUCT INFO ===');
  console.log(productInfo);

  // Step 2: Generate Amazon URLs
  const searchQuery = encodeURIComponent(productInfo.searchQuery || productInfo.name);
  
  // Web URL (fallback)
  const amazonWebUrl = `https://www.amazon.com/s?k=${searchQuery}`;
  
  // Deep link for Amazon app (works on iOS/Android)
  // Format: com.amazon.mobile.shopping://amazon.com/s?k=query
  const amazonAppUrl = `com.amazon.mobile.shopping://amazon.com/s?k=${searchQuery}`;

  return Response.json({ 
    product: productInfo.name,
    searchQuery: productInfo.searchQuery,
    amazonAppUrl,
    amazonWebUrl
  });
};
