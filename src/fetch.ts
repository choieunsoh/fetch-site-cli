import axiosBase, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createLogger, format, transports } from 'winston';

export type MetaData = {
  url: string;
  num_links: number;
  num_images: number;
  last_fetch: Date;
  num_fetches: number;
};

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};
const axios = axiosBase.create({
  headers,
});

const logger = createLogger({
  transports: [new transports.Console()],
  format: format.combine(
    format.colorize(),
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) => {
      return `[${timestamp}] ${level}: ${message}`;
    })
  ),
});

const APP_ROOT_PATH = 'fetch-site-cli';
const IMAGE_SELECTOR = 'img';
const CSS_SELECTOR = 'link[rel="stylesheet"]';
const JS_SELECTOR = 'script[src]';

const META_FILE = 'meta.json';
const META_DB = new Map<string, MetaData>();

(async function main(args: string[]): Promise<void> {
  if (args.length === 0) {
    consoleLog('Usage: node dist/fetch.js <url1> <url2> <url3> <and so on ...>');
    return;
  }

  const appPath = await createAppDirectory(APP_ROOT_PATH);
  await readMetaDataFile();

  const queryMetaData = ['--metadata', '-m'].includes(args[0].toLowerCase());
  const argsOffset = queryMetaData ? 1 : 0;
  const requestUrls = args.slice(argsOffset);

  for (const requestUrl of requestUrls) {
    const url = removeTrailingSlash(requestUrl);

    if (queryMetaData) {
      displayMetaData(url);
      continue;
    }

    await refetchDataFromUrl(appPath, url);
  }
})(process.argv.filter(Boolean).slice(2));

function displayMetaData(url: string): void {
  if (!META_DB.has(url)) {
    consoleError(`Metadata for ${url} not found.`);
    return;
  }

  const metaData = META_DB.get(url);
  consoleLog(`Metadata for ${url}`);
  consoleLog(`  Number of links: ${metaData.num_links}`);
  consoleLog(`  Number of images: ${metaData.num_images}`);
  consoleLog(`  Number of fetches: ${metaData.num_fetches}`);
  consoleLog(`  Last fetch: ${metaData.last_fetch}`);
}

async function refetchDataFromUrl(appPath: string, url: string): Promise<void> {
  try {
    consoleLog(`Fetching ${url} ...`);
    const contentHtml = await fetchData(url);

    const sitePath = await createSiteDirectory(appPath, url);
    const filename = urlToFilename(url);
    const filePath = path.join(appPath, filename);

    const siteBaseUrl = urlToSiteBaseUrl(url);
    const modifiedContentHtml = modifyHtmlContent(contentHtml, siteBaseUrl);
    await writeFile(modifiedContentHtml, filePath);

    await downloadFilesInHtml(url, contentHtml, sitePath);

    await updateMetaData(url, contentHtml);
  } catch (error) {
    consoleError(error.message);
  }
}

function removeTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function isValidUrl(url: string): boolean {
  const urlPattern = /^(https?):\/\/[^\s/$.?#].[^\s]*$/i;
  return urlPattern.test(url);
}

async function fetchData(url: string): Promise<string> {
  try {
    if (!isValidUrl(url)) {
      throw new Error(`${url} is invalid URL.`);
    }

    const response = await axios.get(url);
    const content = response.data;
    consoleLog(`Content fetched from ${url} successfully.`);
    return content;
  } catch (error) {
    if (error instanceof AxiosError) {
      const message = getAxiosErrorMessage(error);
      throw new Error(message);
    }
    throw error;
  }
}

async function writeFile(content: string, filename: string): Promise<void> {
  await safeWriteFile(filename, content);
  consoleLog(`Data written to ${filename} successfully.`);
}

async function safeWriteFile(filePath: string, content: any) {
  const directoryPath = path.dirname(filePath);
  await fs.mkdir(directoryPath, { recursive: true });
  await fs.writeFile(filePath, content);
}

function urlToFilename(url: string): string {
  let filename = url.replace(/^https?:\/\//, '');
  filename = filename.replace(/[\/&?]/g, '_');
  filename += '.html';
  return filename;
}

function urlToSiteBaseUrl(url: string): string {
  let dirname = url.replace(/^https?:\/\//, '');
  dirname = dirname.replace(/[\/&?.:=$]/g, '_');
  return dirname;
}

async function createSiteDirectory(appPath: string, url: string): Promise<string> {
  let dirname = url.replace(/^https?:\/\//, '');
  dirname = dirname.replace(/[\/&?.:=$]/g, '_');
  dirname = path.join(appPath, dirname);
  await fs.mkdir(dirname, { recursive: true });
  return dirname;
}

async function createAppDirectory(appRoot: string): Promise<string> {
  const appPath = path.join(process.cwd(), appRoot);
  await fs.mkdir(appPath, { recursive: true });
  return appPath;
}

async function readMetaDataFile(): Promise<void> {
  const filePath = path.join(APP_ROOT_PATH, META_FILE);
  if (!fsSync.existsSync(filePath)) {
    fs.writeFile(filePath, JSON.stringify([]));
  }
  const json = await fs.readFile(filePath, 'utf8');

  try {
    const metaData: ReadonlyArray<MetaData> = JSON.parse(json);
    for (const meta of metaData) {
      META_DB.set(meta.url, meta);
    }
  } catch (error) {
    consoleLog(`Reading metadata file error: ${error.message}`);
  }
}

async function writeMetaFile(): Promise<void> {
  const filePath = path.join(APP_ROOT_PATH, META_FILE);
  const json = JSON.stringify([...META_DB.values()]);
  await fs.writeFile(filePath, json);
}

function createMetaData(url: string, contentHtml: string): MetaData {
  const [linkCount, imageCount] = countFilesInHtml(contentHtml);
  const prevFetches = META_DB.get(url)?.num_fetches ?? 0;
  return {
    url,
    num_links: linkCount,
    num_images: imageCount,
    last_fetch: new Date(),
    num_fetches: prevFetches + 1,
  };
}

async function updateMetaData(url: string, contentHtml: string) {
  const updatedMetaData = createMetaData(url, contentHtml);
  META_DB.set(url, updatedMetaData);
  await writeMetaFile();
}

function countFilesInHtml(htmlContent: string): [number, number] {
  const $ = cheerio.load(htmlContent);
  const linkCount = countTagsInHtml($, 'a');
  const imageCount = countTagsInHtml($, 'img');
  return [linkCount, imageCount];

  function countTagsInHtml($: cheerio.CheerioAPI, tagName: string): number {
    const elements = $(tagName);
    return elements.length;
  }
}

async function downloadFilesInHtml(baseUrl: string, contentHtml: string, siteDir: string) {
  const $ = cheerio.load(contentHtml);
  const images = listImagesInHtml();
  const cssFiles = listCssFilesInHtml();
  const jsFiles = listJsFilesInHtml();

  const validFiles = [...images, ...cssFiles, ...jsFiles].filter(validFilename);
  const files = validFiles.map((url) => new URL(url, baseUrl).href);

  await downloadFiles(files, siteDir);

  function listImagesInHtml(): ReadonlyArray<string> {
    const elements = $(IMAGE_SELECTOR);
    return elements.map((_, element) => element.attribs.src).toArray();
  }

  function listCssFilesInHtml() {
    const elements = $(CSS_SELECTOR);
    return elements.map((_, element) => element.attribs.href).toArray();
  }

  function listJsFilesInHtml() {
    const elements = $(JS_SELECTOR);
    return elements.map((_, element) => element.attribs.src).toArray();
  }

  function validFilename(file: string): boolean {
    const specialCharactersRegex = /[;:,]/;
    return file.length > 0 && !specialCharactersRegex.test(file);
  }
}

async function downloadFiles(urls: ReadonlyArray<string>, directoryPath: string): Promise<void> {
  const promises = urls.map(async (url, index) => {
    try {
      consoleLog(`Downloading: ${url}`);
      const filename = new URL(url).pathname;
      const filePath = path.join(directoryPath, filename);
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      await safeWriteFile(filePath, response.data);
      consoleLog(`File #${index + 1} downloaded successfully.`);
    } catch (error) {
      consoleError(`Error downloading file ${index + 1}: ${url}`);
      consoleError(`  Details: ${error.message}`);
    }
  });

  await Promise.all(promises);
}

function modifyHtmlContent(htmlContent: string, siteDir: string): string {
  const $ = cheerio.load(htmlContent);
  $(IMAGE_SELECTOR).each((_, element) => {
    modifyPath(element, 'src');
  });

  $(CSS_SELECTOR).each((_, element) => {
    modifyPath(element, 'href');
  });

  $(JS_SELECTOR).each((_, element) => {
    modifyPath(element, 'src');
  });

  return $.html();

  function modifyPath(element: cheerio.Element, attributeName: string) {
    const attributeValue = $(element).attr(attributeName);
    if (attributeValue && !attributeValue.startsWith('http')) {
      const newAttributeValue = path.join(siteDir, attributeValue);
      $(element).attr(attributeName, newAttributeValue);
    }
  }
}

function consoleLog(message: string): void {
  logger.info(message);
}

function consoleError(message: string): void {
  logger.error(message);
}

function getAxiosErrorMessage(error: AxiosError): string {
  if (error.response) {
    if (error.response.status === 404) {
      return `Server responded with status code: ${error.response.status}, and no content was found.`;
    }
    return `Server responded with status code: ${error.response.status}, and data: ${error.response.data}`;
  } else if (error.request) {
    return `${error.request._currentUrl} is invalid URL.`;
  }
  return `Error creating request:' ${error.message}`;
}
