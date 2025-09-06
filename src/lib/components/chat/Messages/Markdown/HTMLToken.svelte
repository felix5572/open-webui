<script lang="ts">
	import DOMPurify from 'dompurify';
	import type { Token } from 'marked';

	import { WEBUI_BASE_URL } from '$lib/constants';
	import Source from './Source.svelte';
	import { settings } from '$lib/stores';

	export let id: string;
	export let token: Token;

	export let onSourceClick: Function = () => {};

	let html: string | null = null;

	$: if (token.type === 'html' && token?.text) {
		html = DOMPurify.sanitize(token.text);
	} else {
		html = null;
	}

  const parseAdkTag = (html: string) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tag = doc.querySelector('adk_function_call, adk_function_response, adk_thought');
    
    if (!tag) return null;

    return {
      name: tag.getAttribute('name'),
      id: tag.getAttribute('id'),
      args: tag.getAttribute('args') && JSON.parse(tag.getAttribute('args')!),
      result: tag.getAttribute('result') && JSON.parse(tag.getAttribute('result')!),
      signature: tag.getAttribute('signature')
    };
  };
</script>

{#if token.type === 'html'}
	{#if html && html.includes('<video')}
		{@const video = html.match(/<video[^>]*>([\s\S]*?)<\/video>/)}
		{@const videoSrc = video && video[1]}
		{#if videoSrc}
			<!-- svelte-ignore a11y-media-has-caption -->
			<video
				class="w-full my-2"
				src={videoSrc.replaceAll('&amp;', '&')}
				title="Video player"
				frameborder="0"
				referrerpolicy="strict-origin-when-cross-origin"
				controls
				allowfullscreen
			></video>
		{:else}
			{token.text}
		{/if}
	{:else if html && html.includes('<audio')}
		{@const audio = html.match(/<audio[^>]*>([\s\S]*?)<\/audio>/)}
		{@const audioSrc = audio && audio[1]}
		{#if audioSrc}
			<!-- svelte-ignore a11y-media-has-caption -->
			<audio
				class="w-full my-2"
				src={audioSrc.replaceAll('&amp;', '&')}
				title="Audio player"
				controls
			></audio>
		{:else}
			{token.text}
		{/if}
	{:else if token.text && token.text.match(/<iframe\s+[^>]*src="https:\/\/www\.youtube\.com\/embed\/([a-zA-Z0-9_-]{11})(?:\?[^"]*)?"[^>]*><\/iframe>/)}
		{@const match = token.text.match(
			/<iframe\s+[^>]*src="https:\/\/www\.youtube\.com\/embed\/([a-zA-Z0-9_-]{11})(?:\?[^"]*)?"[^>]*><\/iframe>/
		)}
		{@const ytId = match && match[1]}
		{#if ytId}
			<iframe
				class="w-full aspect-video my-2"
				src={`https://www.youtube.com/embed/${ytId}`}
				title="YouTube video player"
				frameborder="0"
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
				referrerpolicy="strict-origin-when-cross-origin"
				allowfullscreen
			>
			</iframe>
		{/if}
	{:else if token.text && token.text.includes('<iframe')}
		{@const match = token.text.match(/<iframe\s+[^>]*src="([^"]+)"[^>]*><\/iframe>/)}
		{@const iframeSrc = match && match[1]}
		{#if iframeSrc}
			<iframe
				class="w-full my-2"
				src={iframeSrc}
				title="Embedded content"
				frameborder="0"
				sandbox
				onload="this.style.height=(this.contentWindow.document.body.scrollHeight+20)+'px';"
			></iframe>
		{:else}
			{token.text}
		{/if}
	{:else if token.text && token.text.includes('<status')}
		{@const match = token.text.match(/<status title="([^"]+)" done="(true|false)" ?\/?>/)}
		{@const statusTitle = match && match[1]}
		{@const statusDone = match && match[2] === 'true'}
		{#if statusTitle}
			<div class="flex flex-col justify-center -space-y-0.5">
				<div
					class="{statusDone === false
						? 'shimmer'
						: ''} text-gray-500 dark:text-gray-500 line-clamp-1 text-wrap"
				>
					{statusTitle}
				</div>
			</div>
		{:else}
			{token.text}
		{/if}
	{:else if token.text.includes(`<file type="html"`)}
		{@const match = token.text.match(/<file type="html" id="([^"]+)"/)}
		{@const fileId = match && match[1]}
		{#if fileId}
			<iframe
				class="w-full my-2"
				src={`${WEBUI_BASE_URL}/api/v1/files/${fileId}/content/html`}
				title="Content"
				frameborder="0"
				sandbox="allow-scripts allow-downloads{($settings?.iframeSandboxAllowForms ?? false)
					? ' allow-forms'
					: ''}{($settings?.iframeSandboxAllowSameOrigin ?? false) ? ' allow-same-origin' : ''}"
				referrerpolicy="strict-origin-when-cross-origin"
				allowfullscreen
				width="100%"
				onload="this.style.height=(this.contentWindow.document.body.scrollHeight+20)+'px';"
			></iframe>
		{/if}
	{:else if token.text.includes(`<source_id`)}
		<Source {id} {token} onClick={onSourceClick} />
	{:else if token.text.includes('<adk_function_call')}
		{@const { name: functionName, id: functionId, args: functionArgs } = parseAdkTag(token.text) || {}}
		{#if functionName && functionId}
			<div class="adk-function-call my-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
				<div class="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-medium text-sm">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
					</svg>
					<span>🔧 adk_function_call Calling <code class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{functionName}</code> ing...</span>
				</div>
				<div class="mt-2 text-xs text-gray-600 dark:text-gray-400">
					<span class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">ID: {functionId}</span>
				</div>
				{#if functionArgs && Object.keys(functionArgs).length > 0}
					<div class="mt-2 text-sm">
						<div class="text-gray-600 dark:text-gray-400 text-xs mb-1">Parameters:</div>
						<div class="font-mono text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded border">
							{#each Object.entries(functionArgs) as [key, value]}
								<div><span class="text-blue-600 dark:text-blue-400">{key}:</span> <span class="text-gray-800 dark:text-gray-200">{JSON.stringify(value)}</span></div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{:else if token.text.includes('<adk_function_response')}
		{@const { name: functionName, id: functionId, result: functionResult } = parseAdkTag(token.text) || {}}
		{#if functionName && functionId}
			<div class="adk-function-response my-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
				<div class="flex items-center gap-2 text-green-700 dark:text-green-300 font-medium text-sm">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
					</svg>
					<span>✅ adk_function_response <code class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{functionName}</code> completed</span>
				</div>
				<div class="mt-2 text-xs text-gray-600 dark:text-gray-400">
					<span class="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">ID: {functionId}</span>
				</div>
				{#if functionResult}
					<div class="mt-2 text-sm">
						<div class="text-gray-600 dark:text-gray-400 text-xs mb-1">Result:</div>
						<div class="font-mono text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded border overflow-x-auto">
							<pre class="whitespace-pre-wrap">{JSON.stringify(functionResult, null, 2)}</pre>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{:else if token.text.includes('<adk_thought')}
		{@const { signature: thoughtSignature } = parseAdkTag(token.text) || {}}
		{#if thoughtSignature}
			<details class="adk-thought my-2 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
				<summary class="cursor-pointer text-purple-700 dark:text-purple-300 font-medium text-sm flex items-center gap-2">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"></path>
					</svg>
					<span>🤔 adk_thought AI Thinking Process</span>
				</summary>
				<div class="mt-2 text-xs text-gray-600 dark:text-gray-400">
					<div class="font-mono text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded border">
						<div class="text-orange-600 dark:text-orange-400 mb-1">Encrypted Thought Signature:</div>
						<div class="break-all text-gray-500 dark:text-gray-400">{thoughtSignature.substring(0, 100)}...</div>
						<div class="text-xs text-gray-400 dark:text-gray-500 mt-1 italic">
							This represents the AI's internal reasoning process during response generation.
						</div>
					</div>
				</div>
			</details>
		{/if}
	{:else if token.text.includes('<adk_action')}
		{@const match = token.text.match(/<adk_action type="([^"]+)" data='([^']+)'\s*\/>/)}
		{@const actionType = match && match[1]}
		{@const actionData = match && JSON.parse(match[2])}
		{#if actionType && actionData}
			<div class="adk-action my-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
				<div class="flex items-center gap-2 text-green-700 dark:text-green-300 font-medium text-sm mb-2">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
					</svg>
					<span>⚡ ADK Action: {actionType}</span>
				</div>
				<div class="text-xs text-gray-600 dark:text-gray-400">
					<div class="font-mono text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded border max-h-32 overflow-y-auto">
						<pre class="whitespace-pre-wrap text-wrap">{JSON.stringify(actionData, null, 2)}</pre>
					</div>
				</div>
			</div>
		{/if}
	{:else}
		{@const br = token.text.match(/<br\s*\/?>/)}
		{#if br}
			<br />
		{:else}
			{token.text}
		{/if}
	{/if}
{/if}
