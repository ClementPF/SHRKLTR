package calc.DTO;


/**
 * Created by clementperez on 10/2/16.
 */
public class RivalryStatsDTO extends BaseStatsDTO{

    private Long rivalryStatsId;
    private UserDTO user;
    private UserDTO rival;
    //private StatsDTO stats;
    private TournamentDTO tournament;
    private double score;
    private int position;
    private int gameCount;
    private int winCount;
    private int loseCount;
    private int tieCount;
    private int winStreak;
    private int loseStreak;
    private int tieStreak;
    private double bestScore;
    private double worstScore;
    private int longuestWinStreak;
    private int longuestLoseStreak;
    private int longuestTieStreak;

    public int getLonguestTieStreak() {
        return longuestTieStreak;
    }

    public void setLonguestTieStreak(int longuestTieStreak) {
        this.longuestTieStreak = longuestTieStreak;
    }

    public double getScore() {
        return score;
    }

    public void setScore(double score) {
        this.score = score;
    }

    public int getPosition() { return position; }

    public void setPosition(int position) { this.position = position; }

    public int getGameCount() {
        return gameCount;
    }

    public void setGameCount(int gameCount) {
        this.gameCount = gameCount;
    }

    public int getWinCount() {
        return winCount;
    }

    public void setWinCount(int winCount) {
        this.winCount = winCount;
    }

    public int getLoseCount() {
        return loseCount;
    }

    public void setLoseCount(int loseCount) {
        this.loseCount = loseCount;
    }

    public int getTieCount() {
        return tieCount;
    }

    public void setTieCount(int tieCount) {
        this.tieCount = tieCount;
    }

    public int getWinStreak() {
        return winStreak;
    }

    public void setWinStreak(int winStreak) {
        this.winStreak = winStreak;
    }

    public int getLoseStreak() {
        return loseStreak;
    }

    public void setLoseStreak(int loseStreak) {
        this.loseStreak = loseStreak;
    }

    public int getTieStreak() {
        return tieStreak;
    }

    public void setTieStreak(int tieStreak) {
        this.tieStreak = tieStreak;
    }

    public double getBestScore() {
        return bestScore;
    }

    public void setBestScore(double bestScore) {
        this.bestScore = bestScore;
    }

    public double getWorstScore() {
        return worstScore;
    }

    public void setWorstScore(double worstScore) {
        this.worstScore = worstScore;
    }

    public int getLonguestWinStreak() {
        return longuestWinStreak;
    }

    public void setLonguestWinStreak(int longuestWinStreak) {
        this.longuestWinStreak = longuestWinStreak;
    }

    public int getLonguestLoseStreak() { return longuestLoseStreak;}

    public void setLonguestLoseStreak(int longuestLoseStreak) { this.longuestLoseStreak = longuestLoseStreak; }

    public RivalryStatsDTO() {
        super();
    }

    public Long getRivalryStatsId() {
        return rivalryStatsId;
    }

    public void setRivalryStatsId(Long statsId) {
        this.rivalryStatsId = statsId;
    }

    public UserDTO getUser() {
        return user;
    }

    public void setUser(UserDTO user) {
        this.user = user;
    }

    public UserDTO getRival() {
        return rival;
    }

    public void setRival(UserDTO rival) {
        this.rival = rival;
    }

    public TournamentDTO getTournament() {return tournament; }

    public void setTournament(TournamentDTO tournament) { this.tournament = tournament;
    }
/* prevents infinite nesting
    public StatsDTO getStats() {
        return stats;
    }

    public void setStats(StatsDTO stats) {
        this.stats = stats;
    }*/
}
