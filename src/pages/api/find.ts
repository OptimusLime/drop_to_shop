import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  const runtime = locals.runtime;
  const env = runtime.env as { GEMINI_API_KEY: string };

  const form = await request.formData();
  const file = form.get('image') as File | null;

  if (!file) {
    return new Response('No image provided', { status: 400 });
  }

  const imageBytes = new Uint8Array(await file.arrayBuffer());
  const base64 = btoa(String.fromCharCode(...imageBytes));

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
Search Amazon.com for the most relevant current product.
Return ONLY a direct Amazon product URL (prefer amazon.com/dp/ASIN format).
No explanation. No markdown. Just the URL.`
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
    return new Response(`Gemini API error: ${error}`, { status: 500 });
  }

  const json = await res.json();
  
  // Extract URL from response
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  
  if (!text) {
    return new Response('No response from Gemini', { status: 500 });
  }

  // Extract URL if it's wrapped in anything
  const urlMatch = text.match(/https?:\/\/[^\s<>"]+amazon[^\s<>"]+/i);
  const url = urlMatch ? urlMatch[0] : text;

  // Validate it looks like an Amazon URL
  if (!url.includes('amazon')) {
    return new Response(`Could not find Amazon URL. Gemini returned: ${text}`, { status: 400 });
  }

  return Response.redirect(url, 302);
};
