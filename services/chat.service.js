import {
    getConversation,
    saveConversation,
    deleteConversation
} from "../repositories/conversation.repository.js";
import { validateApiResponse } from "../validators/response.validator.js";

import { generateAdvisorResponse } from "./advisor.service.js";

import {
    enrichDiagnosis,
    generateSolutionAnalysis
} from "./diagnosis.service.js";

import { env } from "../config/env.js";

function trimHistory(history) {
    if (history.length <= env.maxHistory) {
        return history;
    }

    return [
        history[0],
        ...history.slice(-(env.maxHistory - 1))
    ];
}

export async function processChat({ userId, prompt }) {
    let history = getConversation(userId);

    history.push({
        role: "user",
        content: prompt
    });

    history = trimHistory(history);

    const { response } = await generateAdvisorResponse(history);

    let finalResponse = response;

    if (response.estado === "diagnostico") {
        const enrichedDiagnosis = enrichDiagnosis(response);

        const analyzedDiagnosis = await generateSolutionAnalysis(
            enrichedDiagnosis
        );

        finalResponse = {
            estado: "diagnostico",
            diagnostico: analyzedDiagnosis,
            conclusion: response.conclusion
        };
    }

    const validatedResponse = validateApiResponse(finalResponse);

    history.push({
        role: "assistant",
        content: JSON.stringify(validatedResponse)
    });

    history = trimHistory(history);

    saveConversation(userId, history);

    return validatedResponse;
}

export function resetConversation(userId) {
    deleteConversation(userId);
}