package calc.entity;

import javax.persistence.*;
import java.util.List;
import java.util.Set;

/**
 * Created by clementperez on 9/13/16.
 */
@Entity
public class Sport {

    @Id
    @GeneratedValue(strategy= GenerationType.AUTO)
    private Long sportId;
    @Column(unique = true, nullable = false)
    private String name;
/*
    @OneToOne(mappedBy = "sport", cascade = CascadeType.ALL)
    private Tournament mainTourmanent;*/

    @OneToMany(mappedBy = "sport", cascade = CascadeType.ALL)
    private List<Tournament> tournaments;

    public Sport() {
        super();
    }

    public Sport(String name) {
        this.name = name;
    }

    public Long getSportId() {
        return sportId;
    }

    public void setSportId(Long id) {
        this.sportId = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
/*
    public List<Tournament> getTournaments() {
        return tournaments;
    }*/

    public void setTournaments(List<Tournament> tournaments) {
        this.tournaments = tournaments;
    }
/*
    public Tournament getMainTourmanent() {
        return mainTourmanent;
    }

    public void setMainTourmanent(Tournament mainTourmanent) {
        this.mainTourmanent = mainTourmanent;
    }*/
}
