import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sampleText, text, playFlacFile} from "./utils.ts";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFile } from "fs/promises";

const server = new McpServer({
  name: "TTS Bot",
  description:
    "A bot that helps you translate text to speech from english to another language.",
  version: "1.0.0",
});

server.tool("init", { prompt: z.string() }, async ({ prompt }, ctx) => {
  if (prompt.includes("languages")) {
    const response = await sampleText(ctx, "languages", "languages");
    return text(response);
  } else if (prompt.includes("voices")) {
    const response = await sampleText(ctx, "voices", "voices");
    return text(response);
  } else {
    const textToSpeechResponse = await sampleText(ctx, "speaker", prompt);
    return text(textToSpeechResponse);
  }
});

server.tool("voices", { _prompt: z.string() }, async (_, ctx) => {
  const apiKey = process.env.CAMB_AI_API_KEY;
  if (!apiKey) return text("Error: CAMB_AI_API_KEY is not set");

  const response = await fetch("https://client.camb.ai/apis/list-voices", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });
  const parsedResponse = await response.json();
  return text(JSON.stringify(parsedResponse));
});

server.tool("languages", { _prompt: z.string() }, async (_, ctx) => {
  const apiKey = process.env.CAMB_AI_API_KEY;
  if (!apiKey) return text("Error: CAMB_AI_API_KEY is not set");

  const response = await fetch("https://client.camb.ai/apis/target-languages", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });
  const parsedResponse = await response.json();
  return text(JSON.stringify(parsedResponse));
});

const pollTaskUntilSuccess = async (taskId: string) => {
  if (!process.env.CAMB_AI_API_KEY)
    throw new Error("CAMB_AI_API_KEY is not set");

  const options = {
    method: "GET",
    headers: {
      "x-api-key": process.env.CAMB_AI_API_KEY,
    },
  };

  const url = `https://client.camb.ai/apis/tts/${taskId}`;
  const response = await fetch(url, options);
  const json = (await response.json()) as { status: string; run_id: number };
  if (json.status.toLowerCase() === "success") {
    return json.run_id;
  }
  return await pollTaskUntilSuccess(taskId);
};

const downloadAudioFile = async (runId: number, filename: string) => {
  if (!process.env.CAMB_AI_API_KEY)
    throw new Error("Error: CAMB_AI_API_KEY is not set");

  const options = {
    method: "GET",
    headers: {
      "x-api-key": process.env.CAMB_AI_API_KEY,
    },
  };

  const url = `https://client.camb.ai/apis/tts-result/${runId}`;
  const file = await fetch(url, options);
  const blob = await file.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await writeFile(filename, buffer);
  return filename;
};

server.tool("speech", { prompt: z.string() }, async ({ prompt }, ctx) => {
  if (!process.env.CAMB_AI_API_KEY)
    return text("Error: CAMB_AI_API_KEY is not set");

  const [locale, textToSpeech] = prompt.split(":");

  const languages = await sampleText(
    ctx,
    "languages",
    locale ? `locale: ${locale}` : "all"
  );
  const parsedLanguages = JSON.parse(languages) as {
    languages: { id: string; name: string; locale: string }[];
  };
  const language = parsedLanguages.languages[0];

  if (!language) return text("Error: No language found");

  const voices = await sampleText(ctx, "voices", "voices");
  const parsedVoices = JSON.parse(voices) as {
    voices: { id: string; name: string; gender: number; age: number }[];
  };
  const firstVoice = parsedVoices.voices[0];
  if (!firstVoice) return text("Error: No voices available");

  const { id: voiceId, gender, age } = firstVoice;
  const body = {
    text: textToSpeech,
    voice_id: voiceId,
    language: language.id,
    gender: gender,
    age: age,
  };
  const options = {
    method: "POST",
    headers: {
      "x-api-key": process.env.CAMB_AI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };

  let taskId = "";
  try {
    const textToSpeechResponse = await fetch(
      "https://client.camb.ai/apis/tts",
      options
    );
    const json = (await textToSpeechResponse.json()) as { task_id: string };
    taskId = json.task_id;
  } catch (error) {
    return text(`Error: ${error}`);
  }

  let runId: number | null = null;
  try {
    runId = await pollTaskUntilSuccess(taskId);
  } catch (error) {
    return text(`Error: ${error}`);
  }

  try {
    const filename = await downloadAudioFile(runId, "generated_speech.flac");
    await playFlacFile(`./${filename}`);
    return text(`Translated TTS generated and downloaded to ${filename}`);
  } catch (error) {
    return text(`Error: ${error}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
