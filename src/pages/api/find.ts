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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${env.GEMINI_API_KEY}`,
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
              text: `Identify the object in the image.
Search Amazon.com for the 3 most relevant current products.
Return ONLY a JSON array of 3 objects with "title" (short product name) and "url" (Amazon product URL, prefer amazon.com/dp/ASIN format).
No explanation. No markdown. Just valid JSON array.
Example: [{"title":"Product Name","url":"https://amazon.com/dp/B123"}]`
            }
          ]
        }],
        tools: [{
          googleSearch: {}
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
  console.log('Gemini raw response:', JSON.stringify(json, null, 2));
  
  // Extract text from response
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  
  if (!text) {
    console.error('No text in response:', json);
    return Response.json({ error: 'No response from Gemini' }, { status: 500 });
  }

  console.log('Gemini text:', text);

  // Parse JSON from response (strip markdown code blocks if present)
  let products;
  try {
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim();
    products = JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse JSON:', text);
    return Response.json({ error: 'Failed to parse Gemini response', raw: text }, { status: 500 });
  }

  console.log('Parsed products:', products);

  return Response.json({ products });
};
