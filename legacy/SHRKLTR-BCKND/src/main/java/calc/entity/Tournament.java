package calc.entity;

import javax.persistence.*;
import java.util.List;

/**
 * Created by clementperez on 9/13/16.
 */
@Entity
@NamedQueries({
        @NamedQuery(name = "Tournament.findByName", query = "SELECT t FROM Tournament t WHERE t.name = ?1"),
        @NamedQuery(name = "Tournament.findBySportId", query = "SELECT t FROM Tournament t WHERE t.sport.sportId = ?1"),
        @NamedQuery(name = "Tournament.findByUserName",
                query = "SELECT t FROM Tournament t " +
                        "INNER JOIN t.stats s " +
                        "WHERE s.user.userName = ?1" )
})
@Table(uniqueConstraints={@UniqueConstraint(columnNames={"name"})})
public class Tournament {

    @Id
    @GeneratedValue(strategy= GenerationType.AUTO)
    private Long tournamentId;
    @Column(nullable = false)
    private String name;
    @Column(nullable = false)
    private String displayName;
    @Column(nullable = false)
    private Boolean isOver;

    @ManyToOne
    @JoinColumn(name = "sportId")
    private Sport sport;

    @ManyToOne
    @JoinColumn(name = "userId")
    private User owner;

    @OneToMany(mappedBy = "tournament", cascade = CascadeType.ALL)
    private List<Game> games;

    @OneToMany(mappedBy = "tournament", cascade = CascadeType.ALL)
    private List<Stats> stats;

    public Tournament() {
        super();
    }

    public Tournament(String displayName, Sport sport, User owner) {
        name = displayName.replaceAll("\\s+","").toLowerCase();
        this.displayName = displayName;
        this.sport = sport;
        this.owner = owner;
        this.isOver = false;
    }

    public Long getTournamentId() {
        return tournamentId;
    }

    public void setTournamentId(Long tournamentId) {
        this.tournamentId = tournamentId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDisplayName() { return displayName; }

    public void setDisplayName(String displayName) { this.displayName = displayName; }

    public Boolean getIsOver() {
        return isOver;
    }

    public void setIsOver(Boolean isOver) {
        this.isOver = isOver;
    }

    public Sport getSport() {
        return sport;
    }

    public void setSport(Sport sport) {
        this.sport = sport;
    }

    public User getOwner() { return owner; }

    public void setOwner(User owner) { this.owner = owner; }

    public List<Game> getGames() {
        return games;
    }

    public void setGames(List<Game> games) {
        this.games = games;
    }

    public List<Stats> getStats() {
        return stats;
    }

    public void setStats(List<Stats> stats) {
        this.stats = stats;
    }

    public boolean equals(Tournament obj) {
        if (this.getTournamentId() == null || obj == null) {
            return false;
        }
        else {
            return this.getTournamentId() == obj.getTournamentId();
        }
    }
}
