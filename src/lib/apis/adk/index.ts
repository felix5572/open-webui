import { WEBUI_BASE_URL } from '$lib/constants';
// import { v4 as uuidv4 } from 'uuid';
export const DEFAULT_ADK_BASE_URL = process.env.DEFAULT_ADK_BASE_URL || 'https://deepmodeling--deepmd-lammps-agent-services-agent-app.modal.run';
export const DEFAULT_ADK_APP_NAME = process.env.DEFAULT_ADK_APP_NAME || 'deepmd_agent';
// import type { OpenAIRequest } from '$lib/apis/openai';

export interface AdkRequest {
	app_name: string;
	user_id: string;
	session_id: string;
	streaming: boolean;
	newMessage: {
		role: 'user';
		parts: Array<{ text: string }>;
	};
}

// ADK Event structure that matches MessageType.adk_event
export interface AdkEvent {
	// === Core ADK Event Identification ===
	invocationId?: string;        // Unique ID for entire conversation interaction, e.g. "e-dd22b5f0-34b0-4389-835c-f24a08d20e92"
	author?: string;              // Event originator: 'user' or agent name like 'capital_agent'
	id?: string;                  // Unique ID for this specific event, e.g. "3730cb16-5d56-4ac4-967b-5c16901ca301"
	timestamp?: number;           // Event creation timestamp (epoch milliseconds), e.g. 1756920093.083266
	
	// === Streaming Processing Control ===
	partial?: boolean;            // true=streaming chunk, false=complete response. Used to determine if more data follows
	finishReason?: string;        // Completion reason: 'STOP'=normal completion, 'LENGTH'=length limit, 'SAFETY'=safety filter
	turnComplete?: boolean;       // Whether conversation turn is complete, works with partial to determine final response
	
	// === Error Handling ===
	errorCode?: string;           // Error code like 'SAFETY_FILTER_TRIGGERED', 'RESOURCE_EXHAUSTED'
	errorMessage?: string;        // Detailed error message
	
	// === Content Structure ===
	content?: {
		parts: Array<{
			// Text content
			text?: string;                    // Actual text response content
			
			// ADK thinking process (encrypted thought signature)
			thoughtSignature?: string;        // Encrypted thinking process, usually long base64 string
			
			// Tool call request (LLM requesting tool execution)
			functionCall?: {
				id: string;                   // Tool call ID like "adk-12617a30-e72d-45d2-a3fc-a9e75071d4a1"
				name: string;                 // Tool name like "get_capital_city", "search_web"
				args: Record<string, any>;   // Tool parameters like {"country": "Japan"}
			};
			
			// Tool execution result (tool returning result to LLM)
			functionResponse?: {
				id: string;                   // Corresponding tool call ID
				name: string;                 // Tool name
				response: { result: any };   // Tool return result like {"result": "Tokyo"}
			};
		}>;
		role: string;                         // 'user'=user input, 'model'=AI response
	};
	
	// === Token Usage Statistics ===
	usageMetadata?: {
		candidatesTokenCount?: number;        // Number of candidate response tokens generated
		promptTokenCount?: number;            // Number of input prompt tokens
		promptTokensDetails?: Array<{         // Token breakdown by modality
			modality: string;                 // 'TEXT', 'IMAGE', 'AUDIO', etc.
			tokenCount: number;               // Token count for this modality
		}>;
		thoughtsTokenCount?: number;          // Tokens consumed by thinking process
		totalTokenCount?: number;             // Total tokens (sum of all types)
	};
	
	// === ADK Actions and Control Flow ===
	actions?: {
		// State management
		stateDelta?: Record<string, any>;     // Session state changes like {"user_status": "verified"}
		artifactDelta?: Record<string, any>;  // File/artifact change records
		requestedAuthConfigs?: Record<string, any>; // Authentication configuration requests
		
		// Control flow signals
		transferToAgent?: string;             // Transfer to another agent like "BillingAgent"
		escalate?: boolean;                   // true=escalate processing (exit loops, etc.)
		skipSummarization?: boolean;          // true=skip summarization processing
	};
	
	// === Tool Execution Tracking ===
	longRunningToolIds?: string[];            // List of long-running tool IDs
	
	// === Multi-Agent Hierarchy ===
	branch?: string;                          // Agent execution branch path for complex multi-agent systems
}


  const processAdkStream = async (
    stream: ReadableStream<Uint8Array>,
    onEvent: (event: AdkEvent) => void
  ) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
  
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
  
        const lines = decoder.decode(value).split('\n');
        for (const line of lines.filter(l => l.startsWith('data:'))) {
          try {
            const event = JSON.parse(line.replace(/^data:\s*/, '')) as AdkEvent;
            onEvent(event); // 触发回调
          } catch (e) {
            console.error('google adk parse failed :', e);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };


/**
 * Generate ADK chat completion with SSE streaming
 */
export const generateAdkChatCompletion = async (
	adkBaseUrl: string,
	body: AdkRequest,
	token?: string,
    eventHandler?: (event: AdkEvent) => void
): Promise<Response> => {
	console.log('generateAdkChatCompletion url', `${adkBaseUrl}/run_sse`);
	console.log('generateAdkChatCompletion body', body);
	console.log('generateAdkChatCompletion token', token);
	const res = await fetch(`${adkBaseUrl}/run_sse`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token && { 'Authorization': `Bearer ${token}` })
		},
		body: JSON.stringify(body)
	});

	if (!res.ok) {
		const error = await res.text();
		throw new Error(`ADK API Error: ${res.status} - ${error}`);
	}

    if (eventHandler && res.body) {
        processAdkStream(res.body, eventHandler).catch(console.error);
      }

	return res;
};


export const checkOrCreateAdkSession = async (
    adkBaseUrl: string,
    appName: string,
    userId: string,
    sessionId: string,
    token?: string
): Promise<string> => {
    const url = `${adkBaseUrl}/apps/${appName}/users/${userId}/sessions/${sessionId}`;
    
    // 先尝试获取会话
    const getRes = await fetch(url, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        }
    });
    
    if (getRes.status === 200) {
        return sessionId;
    }
    
    if (getRes.status === 404) {
        const createRes = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token && { 'Authorization': `Bearer ${token}` })
            },
            body: JSON.stringify({})
        });
        
        if (createRes.ok) {
            return sessionId; // 创建成功后返回 sessionId
        } else {
            const errorText = await createRes.text();
            throw new Error(`ADK session creation failed: ${createRes.status} - ${errorText}`);
        }
    }
    
    // 其他错误
    throw new Error(`Unexpected response: ${getRes.status}`);
};



//

export const checkAdkSession = async (
    adkBaseUrl: string,
    appName: string,
    userId: string,
    sessionId: string,
    token?: string
): Promise<boolean> => {
    const url = `${adkBaseUrl}/apps/${appName}/users/${userId}/sessions/${sessionId}`;
    
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(token && { 'Authorization': `Bearer ${token}` })
            }
        });
        
        return res.ok;
    } catch (error) {
        console.error('ADK session check failed:', error);
        return false;
    }
};


/**
 * Create ADK session
 */

export const createAdkSession = async (
    adkBaseUrl: string,
    appName: string,  // 例如 "deepmd_agent"
    userId: string,   // 例如 "raw_test_user"
    sessionId: string, // 直接传入 Open WebUI 的 chatId
    token?: string    // 可选认证 token
  ): Promise<{ id: string }> => {
    const url = `${adkBaseUrl}/apps/${appName}/users/${userId}/sessions/${sessionId}`;
    console.warn('createAdkSession url', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }) // openwebui token
      },
      body: JSON.stringify({}) // 空对象或其他初始化数据
    });
  
    if (!res.ok) {
      throw new Error(`ADK session creation failed: ${res.status}`);
    }
    return { id: sessionId }; // 直接返回传入的 sessionId
  };


/**
 * Extract text content from ADK response parts (legacy function, kept for compatibility)
 * Note: New implementation should use the expanded format in adkEventHandler
 */
export const extractTextFromAdkParts = (parts: NonNullable<AdkEvent['content']>['parts'] = []): string => {
	return parts
		.filter(part => part.text)
		.map(part => part.text)
		.join('');
};

/**
 * Convert ADK parts to expanded markup format
 */
export const createAdkFunctionCallTag = (name: string, id: string, args: any): string => {
	const doc = new DOMParser().parseFromString('', 'text/html');
	const tag = doc.createElement('adk_function_call');
	
	tag.setAttribute('name', name);
	tag.setAttribute('id', id);
	tag.setAttribute('args', JSON.stringify(args));
	
	const serializer = new XMLSerializer();
  	return `\n${serializer.serializeToString(tag)}\n`;
  };


  export const createAdkFunctionResponseTag = (name: string, id: string, response: any): string => {
	const doc = new DOMParser().parseFromString('', 'text/html');
	const tag = doc.createElement('adk_function_response');
	
	tag.setAttribute('name', name);
	tag.setAttribute('id', id);
	tag.setAttribute('result', JSON.stringify(response));
	
	const serializer = new XMLSerializer();
  	return `\n${serializer.serializeToString(tag)}\n`;
  };

  export const createAdkThoughtTag = (signature: string): string => {
	const doc = new DOMParser().parseFromString('', 'text/html');
	const tag = doc.createElement('adk_thought');
	
	tag.setAttribute('signature', signature);
	
	const serializer = new XMLSerializer();
  	return `\n${serializer.serializeToString(tag)}\n`;
  };

export const convertAdkPartsToMarkup = (parts: NonNullable<AdkEvent['content']>['parts'] = []): string => {
	let content = '';
	
	for (const part of parts) {
		if (part.text) {
			// Standard text content
			content += part.text;
			
		} else if (part.functionCall) {
			// Function call - convert to custom markup
			content += createAdkFunctionCallTag(
				part.functionCall.name,
				part.functionCall.id,
				part.functionCall.args
			  );
			
		} else if (part.functionResponse) {
			// Function response - convert to custom markup
			content += createAdkFunctionResponseTag(
				part.functionResponse.name,
				part.functionResponse.id,
				part.functionResponse.response
			  );
			
		} else if (part.thoughtSignature) {
			// AI thinking process - convert to custom markup
			content += createAdkThoughtTag(part.thoughtSignature);
		}
		else {
			content += "raw part from agent:\n" + JSON.stringify(part);
		}
	}
	
	return content;
};

/**
 * Convert ADK actions to expanded markup format
 */
export const convertAdkActionsToMarkup = (actions: AdkEvent['actions']): string => {
	if (!actions) return '';
	
	let content = '';
	
	for (const [key, value] of Object.entries(actions)) {
		// Skip null, undefined, empty arrays, empty objects, but keep false and 0
		if (value === null || value === undefined || 
			(Array.isArray(value) && !value.length) || 
			(typeof value === 'object' && !Object.keys(value).length)) {
			continue;
		}
		
		content += `\n<adk_action type="${key}" data='${JSON.stringify(value)}' />\n`;
	}
	
	return content;
};

/**
 * Check if ADK response is final (equivalent to event.is_final_response() in Python SDK)
 * Based on the ADK documentation pseudocode logic
 */
export const isAdkResponseFinal = (adkEvent: AdkEvent): boolean => {
	// Must not be partial - this is the fundamental requirement
	if (adkEvent.partial) {
		return false;
	}
	
	// Check different types of final responses:
	
	// 1. Text content response (streaming text completion)
	const hasTextContent = adkEvent.content?.parts?.some(part => part.text);
	
	// 2. Function/tool response completion
	const hasFunctionResponse = adkEvent.content?.parts?.some(part => part.functionResponse);
	
	// 3. Long running tools initiated
	const hasLongRunningTools = adkEvent.longRunningToolIds && adkEvent.longRunningToolIds.length > 0;
	
	// 4. Turn completion signal
	const isTurnComplete = adkEvent.turnComplete === true;
	
	// 5. Skip summarization action (tool result display)
	const hasSkipSummarization = adkEvent.actions?.skipSummarization === true;
	
	// Any of these conditions indicates a final, displayable event
	return hasTextContent || hasFunctionResponse || hasLongRunningTools || isTurnComplete || hasSkipSummarization;
};

/**
 * Get function responses from ADK event (equivalent to event.get_function_responses() in Python SDK)
 */
export const getAdkFunctionResponses = (adkEvent: AdkEvent) => {
	return adkEvent.content?.parts?.filter(part => part.functionResponse) || [];
};

/**
 * Check if ADK event has long running tools
 */
export const hasAdkLongRunningTools = (adkEvent: AdkEvent): boolean => {
	return !!(adkEvent.longRunningToolIds && adkEvent.longRunningToolIds.length > 0);
};
