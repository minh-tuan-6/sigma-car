export default {
  async fetch(request, env) {
    try {
      const result = await env.AI.run(
        "@cf/zai-org/glm-4.7-flash",
        {
          messages: [
            {
              role: "system",
              content: "Bạn là Sigma AI, chuyên gia tư vấn ô tô. Trả lời bằng tiếng Việt, không bịa thông số xe."
            },
            {
              role: "user",
              content: "Tôi có 800 triệu, gia đình 4 người, đi làm 50 km mỗi ngày. Nên chọn xe như thế nào?"
            }
          ],
          max_completion_tokens: 1024
        }
      );

      return Response.json(result);
    } catch (error) {
      console.error("Workers AI error:", error);
      return Response.json(
        { error: "AI inference failed" },
        { status: 502 }
      );
    }
  }
};
