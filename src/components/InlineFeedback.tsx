export function InlineFeedback({
  feedback,
}: {
  feedback: { acceptedAnswers: string[] };
}) {
  return (
    <div className="feedback incorrect" role="status">
      <span>Accepted: {feedback.acceptedAnswers.join(", ")}</span>
    </div>
  );
}
