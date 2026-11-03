package calc.entity;

import javax.persistence.*;

/**
 * Created by clementperez on 02/06/18.
 */
@Entity
@NamedQueries({
        @NamedQuery(name = "RivalryStats.findByUserId", query = "SELECT s FROM RivalryStats s WHERE s.user.userId = ?1"),
        @NamedQuery(name = "RivalryStats.findByRivalId", query = "SELECT s FROM RivalryStats s WHERE s.rival.userId = ?1"),
        @NamedQuery(name = "RivalryStats.findByStatsId", query = "SELECT s FROM RivalryStats s WHERE s.stats.statsId = ?1"),
        @NamedQuery(name = "RivalryStats.findByUserAndTournament", query = "SELECT s FROM RivalryStats s WHERE s.user.userId = ?1 AND s.tournament.name = ?2"),
        @NamedQuery(name = "RivalryStats.findByRivalAndTournament", query = "SELECT s FROM RivalryStats s WHERE s.rival.userId = ?1 AND s.tournament.name = ?2"),
        @NamedQuery(name = "RivalryStats.findByUserUserIdAndTournament", query = "SELECT s FROM RivalryStats s WHERE s.user.userId = ?1 AND s.tournament.name = ?2"),
        @NamedQuery(name = "RivalryStats.findByRivalUserIdAndTournament", query = "SELECT s FROM RivalryStats s WHERE s.rival.userId = ?1 AND s.tournament.name = ?2"),
        @NamedQuery(name = "RivalryStats.findByUserUsernameAndTournament", query = "SELECT s FROM RivalryStats s WHERE s.user.userName = ?1 AND s.tournament.name = ?2"),
        @NamedQuery(name = "RivalryStats.findByRivalUsernameAndTournament", query = "SELECT s FROM RivalryStats s WHERE s.rival.userId = ?1 AND s.tournament.name = ?2"),
        @NamedQuery(name = "RivalryStats.findByUserAndRivalAndTournament", query = "SELECT s FROM RivalryStats s WHERE s.user.userId = ?1 AND s.rival.userId = ?2 AND s.tournament.name = ?3"),
        @NamedQuery(name = "RivalryStats.findByUserUserIdAndRivalUserIdAndTournament", query = "SELECT s FROM RivalryStats s WHERE s.user.userId = ?1 AND s.rival.userId = ?2 AND s.tournament.name = ?3"),
        @NamedQuery(name = "RivalryStats.findByUserUsernameAndRivalUsernameTournament", query = "SELECT s FROM RivalryStats s WHERE s.user.userName = ?1 AND s.rival.userName = ?2 AND s.tournament.name = ?3")
})
public class RivalryStats {

    @Id
    @GeneratedValue(strategy= GenerationType.AUTO)
    private Long rivalryStatsId;

    @ManyToOne
    @JoinColumn(name="tournamentId")
    private Tournament tournament;
    @ManyToOne
    @JoinColumn(name="userId", nullable = false)
    private User user;
    @ManyToOne
    @JoinColumn(name="rivalId", nullable = false)
    private User rival;
    @OneToOne
    @JoinColumn(name="statsId", nullable = false)
    private Stats stats;

    private double score;
    private double bestScore;
    private double worstScore;
    private int gameCount;
    private int winCount;
    private int loseCount;
    private int tieCount;
    private int winStreak;
    private int loseStreak;
    private int tieStreak;
    private int longuestWinStreak;
    private int longuestLoseStreak;
    private int longuestTieStreak;

    public RivalryStats() {
        super();
    }

    public RivalryStats(User owner, User rival, Stats userStats) {
        super();
        this.tournament = userStats.getTournament();
        this.user = owner;
        this.rival = rival;
        this.stats = userStats;
        setScore(0);
        setBestScore(0);
        setWorstScore(0);
    }

    public double getScore() {
        return score;
    }

    public void setScore(double score) {
        this.score = score;
        if(this.score > this.bestScore)
            setBestScore(this.score);
        if(this.score < this.worstScore)
            setWorstScore(this.score);
    }

    public int getGameCount() {
        return gameCount;
    }

    public void setGameCount(int gameCount) {
        this.gameCount = gameCount;
    }

    public void addWin() {
        gameCount++;
        winCount++;
        setWinStreak(winStreak + 1);
        loseStreak = 0;
        tieStreak = 0;
    }

    public void addLose() {
        gameCount++;
        loseCount++;
        setLoseStreak(loseStreak + 1);
        winStreak = 0;
        tieStreak = 0;
    }

    public void addTie() {
        gameCount++;
        tieCount++;
        setTieStreak(tieStreak + 1);
        winStreak = 0;
        loseStreak = 0;
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
        setLonguestWinStreak(Math.max(this.winStreak, this.longuestWinStreak));
    }

    public int getLoseStreak() {
        return loseStreak;
    }

    public void setLoseStreak(int loseStreak) {
        this.loseStreak = loseStreak;
        setLonguestLoseStreak(Math.max(this.loseStreak, this.longuestLoseStreak));
    }

    public int getTieStreak() {
        return tieStreak;
    }

    public void setTieStreak(int tieStreak) {
        this.tieStreak = tieStreak;
        setLonguestTieStreak(Math.max(this.tieStreak, this.longuestTieStreak));
    }

    public double getBestScore() {
        return bestScore;
    }

    public void setBestScore(double bestScore) { this.bestScore = bestScore;}

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

    public int getLonguestLoseStreak() {
        return longuestLoseStreak;
    }

    public void setLonguestLoseStreak(int longuestLoseStreak) {
        this.longuestLoseStreak = longuestLoseStreak;
    }

    public int getLonguestTieStreak() {return longuestTieStreak;}

    public void setLonguestTieStreak(int longuestTieStreak) {this.longuestTieStreak = longuestTieStreak; }

    public Long getRivalryStatsId() {
        return rivalryStatsId;
    }

    public void setRivalryStatsId(Long rivalryStatsId) {
        this.rivalryStatsId = rivalryStatsId;
    }

    public Tournament getTournament() {
        return tournament;
    }

    public void setTournament(Tournament t){
        this.tournament = t;
    }

    public void setUser(User user) {
        this.user = user;
    }

    public User getUser() {
        return user;
    }

    public User getRival() {
        return rival;
    }

    public void setRival(User user) {
        this.rival = user;
    }

    public Stats getStats() {
        return stats;
    }

    public void setStats(Stats stats) {
        this.stats = stats;
    }
}

